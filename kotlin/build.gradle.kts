import com.vanniktech.maven.publish.MavenPublishBaseExtension
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.2.21"
    id("com.vanniktech.maven.publish") version "0.37.0"
}

group = "io.github.markusaugust"

// The version is in `gradle.properties`, and is the same as the npm package's.

repositories {
    mavenCentral()
}

/*
 * Chicory runs WebAssembly in pure Java. No JNI, no JavaScript, no runtime
 * to install: it is a Maven dependency that works wherever the JVM works. It
 * is the only dependency the package has.
 */
dependencies {
    implementation("com.dylibso.chicory:runtime:1.7.5")
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter-params:5.13.4")
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

// Java 17 as the minimum: it covers the LTS versions most teams are on.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

/*
 * Everything the package is built from comes from the npm package for the
 * same version: the core, the manifest and the files for the browser. The
 * build therefore needs neither Rust nor Bun, and
 * `io.github.markusaugust:lo-tek-interfaces` is built from exactly the files
 * `@lo-tek/interfaces` with the same version consists of.
 *
 * Without `-Plotek.package` the version is fetched from npm. Between two
 * releases the code here is newer than what is there, and then the tarball
 * is packed from the repository and passed with
 * `-Plotek.package=<path to .tgz>`, as CI does.
 */
val fetchPackage = tasks.register<no.lotek.build.FetchPackage>("fetchPackage") {
    packageVersion.set(version.toString())
    tarball.set(layout.buildDirectory.file("npm/interfaces-$version.tgz"))
}

/*
 * `lotek.package` is the tarball, or the directory `npm pack` wrote it to. In
 * a directory, the file with the version in its name is used, so an old
 * tarball next to it is not picked up by mistake. Chosen here and not with
 * `orElse`, which loses the dependency on `fetchPackage`.
 */
val localPackage = providers.gradleProperty("lotek.package").orNull?.let { rootDir.resolve(it) }
val packageTgz: Provider<RegularFile> =
    if (localPackage != null) {
        val tgz = if (localPackage.isDirectory) localPackage.resolve("lo-tek-interfaces-$version.tgz") else localPackage
        check(tgz.isFile) { "Could not find the npm package $tgz. Pack it with bun --filter @lo-tek/interfaces pack." }
        provider { layout.projectDirectory.file(tgz.absolutePath) }
    } else {
        fetchPackage.flatMap { it.tarball }
    }

val unpackPackage = tasks.register<Sync>("unpackPackage") {
    // npm puts everything under `package/` in the tarball.
    from(tarTree(packageTgz)) {
        eachFile { relativePath = RelativePath(true, *relativePath.segments.drop(1).toTypedArray()) }
    }
    includeEmptyDirs = false
    into(layout.buildDirectory.dir("lotek-package"))
    val expected = version.toString()
    // Otherwise the task counts as up to date when only the version changed, and the check is skipped.
    inputs.property("version", expected)
    doLast {
        val pkg = groovy.json.JsonSlurper().parse(destinationDir.resolve("package.json")) as Map<*, *>
        check(pkg["name"] == "@lo-tek/interfaces" && pkg["version"] == expected) {
            "The tarball is ${pkg["name"]}@${pkg["version"]}, but the Kotlin package is $expected. " +
                "The version in kotlin/gradle.properties and interfaces/package.json must be the same."
        }
    }
}

val unpacked = unpackPackage.map { it.destinationDir }
val manifestFile = unpacked.map { layout.projectDirectory.file(it.resolve("manifest/manifest.json").absolutePath) }
val contractFile = unpacked.map { layout.projectDirectory.file(it.resolve("src/tokens/color-contract.json").absolutePath) }

// The module is turned into JVM bytecode here, not when it is loaded. See `buildSrc/`.
val compileCore = tasks.register<no.lotek.build.CompileCore>("compileCore") {
    wasm.set(unpacked.map { layout.projectDirectory.file(it.resolve("core/lotek-core.wasm").absolutePath) })
    classes.set(layout.buildDirectory.dir("chicory/classes"))
    sources.set(layout.buildDirectory.dir("chicory/sources"))
}

// The API is generated from the manifest: the values as `enum`s, and a member of `Lt` for every builder function, with its documentation.
val generateApi = tasks.register<no.lotek.build.GenerateApi>("generateApi") {
    manifest.set(manifestFile)
    output.set(layout.buildDirectory.dir("generated/lotek"))
}

/*
 * The WebJar: the CSS and the JavaScript modules for the browser, with the
 * same paths as in the npm package, under
 * `META-INF/resources/webjars/lo-tek/<version>/`. Spring Boot, Ktor and
 * servlet containers serve that directory as it is, so a Kotlin app needs
 * neither npm nor a CDN. What is only for Node or React is left out.
 */
val webjar = tasks.register<Sync>("webjar") {
    into(layout.buildDirectory.dir("webjar"))
    from(unpacked) {
        include("dist/**/*.js", "dist/lotek.css", "src/components/**/*.css", "src/tokens/**/*.css")
        exclude(
            "dist/cli.js", "dist/wasi-host.js", "dist/react.js", "dist/diagnostics/**", "dist/jsx/**",
            // The theme reads the core from disk, and is for Node, not the browser.
            "dist/tokens/theme.js", "dist/tokens/theme-check.js",
        )
        into("META-INF/resources/webjars/lo-tek/$version")
    }
}

// The manifest and the colour contract in the package. `LO-TEK` gives the core
// the manifest when a consumer does not pass its own, and the contract when
// the theme is built.
tasks.processResources {
    from(manifestFile) { into("no/lotek") }
    from(contractFile) { into("no/lotek") }
}

sourceSets.main {
    resources.srcDir(webjar)
    kotlin.srcDir(generateApi)
    java.srcDir(compileCore.map { it.sources })
    // The classes for the module are already compiled, so they go into the jar as they are.
    resources.srcDir(compileCore.map { it.classes })
}

dependencies {
    compileOnly(files(compileCore.map { it.classes }))
}

tasks.test {
    useJUnitPlatform()
    /*
     * The expected results for parity and the contract are test data in the
     * repository, not part of the npm package, and are therefore read from
     * here. CI packs the tarball from the same commit, so the two are always
     * the same age.
     */
    val core = rootDir.resolve("../core")
    val interfaces = rootDir.resolve("../interfaces")
    systemProperty("parity", core.resolve("parity").absolutePath)
    systemProperty("theme", core.resolve("theme").absolutePath)
    // The fixtures and the build cases are read through a path, so Gradle
    // does not see them without this, and a new fixture would leave the test
    // counted as up to date.
    inputs.dir(core.resolve("parity")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(core.resolve("theme")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.file(interfaces.resolve("manifest/build-cases.json")).withPathSensitivity(PathSensitivity.NONE)
    inputs.file(manifestFile).withPathSensitivity(PathSensitivity.NONE)
    val manifestPath = manifestFile.map { it.asFile.absolutePath }
    jvmArgumentProviders.add(CommandLineArgumentProvider { listOf("-Dmanifest=${manifestPath.get()}") })
    systemProperty("buildCases", interfaces.resolve("manifest/build-cases.json").absolutePath)
    systemProperty("webjar", layout.buildDirectory.dir("webjar/META-INF/resources/webjars/lo-tek/$version").get().asFile.absolutePath)
    // The sources jar Maven Central gets, which is where IntelliJ reads the
    // KDoc of `Lt` from. `SourcesJarTest` requires the generated `Lt.kt` in it.
    val sources = tasks.named<Jar>("sourcesJar")
    dependsOn(sources)
    val sourcesPath = sources.flatMap { it.archiveFile }.map { it.asFile.absolutePath }
    jvmArgumentProviders.add(CommandLineArgumentProvider { listOf("-DsourcesJar=${sourcesPath.get()}") })
    testLogging { events("failed") }
}

/*
 * The release to Maven Central, for all four modules with the same version.
 * `publish.yml` runs it after the npm package is out, and then builds from
 * the published tarball. The username and password for the Central Portal
 * and the signing key come as `ORG_GRADLE_PROJECT_…` from the secrets.
 *
 * Without a key nothing is signed, so `publishToMavenLocal` works on a
 * machine without one. Central rejects an unsigned release anyway.
 */
// A missing secret comes from GitHub as an empty string, not as nothing.
val signeringsnokkel = providers.gradleProperty("signingInMemoryKey").orNull?.isNotBlank() == true
allprojects {
    pluginManager.apply("com.vanniktech.maven.publish")
    extensions.configure<MavenPublishBaseExtension> {
        publishToMavenCentral()
        if (signeringsnokkel) signAllPublications()
        val artefakt = if (project == rootProject) "lo-tek-interfaces" else "lo-tek-${project.name}"
        coordinates(rootProject.group.toString(), artefakt, rootProject.version.toString())
        pom {
            name.set(artefakt)
            description.set(
                when (project.name) {
                    "kotlinx-html" -> "LO-TEK for kotlinx.html: Tag.lt(…) puts the attributes from the builder functions on a tag."
                    "cli" -> "The LO-TEK CLI on the JVM, which the Gradle plugin runs."
                    "gradle-plugin" -> "The Gradle plugin that checks templates against LO-TEK and builds the theme."
                    else -> "LO-TEK for Kotlin and Java: the builder functions, the diagnostics, and the CSS and web components as a WebJar."
                },
            )
            url.set("https://lo-tek.sobernetics.no/kotlin/")
            inceptionYear.set("2026")
            licenses {
                license {
                    name.set("MIT")
                    url.set("https://opensource.org/license/mit")
                    distribution.set("repo")
                }
            }
            developers {
                developer {
                    id.set("MarkusAugust")
                    name.set("August Søberg-Klyver")
                    url.set("https://github.com/MarkusAugust")
                }
            }
            scm {
                url.set("https://github.com/MarkusAugust/lo-tek")
                connection.set("scm:git:https://github.com/MarkusAugust/lo-tek.git")
                developerConnection.set("scm:git:ssh://git@github.com/MarkusAugust/lo-tek.git")
            }
        }
    }
}
