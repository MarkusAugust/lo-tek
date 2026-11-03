import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    kotlin("jvm")
}

/*
 * The command line on the JVM: `java -jar lotek.jar check form.html`.
 *
 * The commands are written in Rust (`cli/`), and the WASI module comes
 * with the npm package as `core/lotek.wasm`. Chicory runs it, compiled to
 * bytecode here, so the jar answers the same as `npx @lo-tek/interfaces` and
 * the executable from `cargo install`. It needs only Java 17, not Node, not
 * Rust.
 */
group = rootProject.group
version = rootProject.version

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.dylibso.chicory:runtime:1.7.5")
    implementation("com.dylibso.chicory:wasi:1.7.5")
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    testLogging { events("failed") }
}

kotlin {
    // The same Kotlin as the consumers': see the root build.
    coreLibrariesVersion = "2.2.21"
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        languageVersion.set(KotlinVersion.KOTLIN_2_2)
        apiVersion.set(KotlinVersion.KOTLIN_2_2)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

// The command line and the files it reads, from the npm package the root project has unpacked.
val unpacked = rootProject.tasks.named<Sync>("unpackPackage").map { it.destinationDir }

val compileCli = tasks.register<no.lotek.build.CompileCore>("compileCli") {
    wasm.set(unpacked.map { layout.projectDirectory.file(it.resolve("core/lotek.wasm").absolutePath) })
    className.set("no.lotek.cli.LotekCli")
    classes.set(layout.buildDirectory.dir("chicory/classes"))
    sources.set(layout.buildDirectory.dir("chicory/sources"))
}

/*
 * The package the command line reads from: the manifest, the colour
 * contract, the rulebooks and the source of the components for
 * `lotek takeover`. The module carries none of them, and `CommandLine` gives
 * it the folder as `LOTEK_PACKAGE`.
 */
tasks.processResources {
    from(unpacked) {
        include("package.json", "manifest/manifest.json", "manifest/files.json", "src/tokens/color-contract.json", "agent/*.md", "src/components/**")
        into("lotek-package")
    }
}

sourceSets.main {
    java.srcDir(compileCli.map { it.sources })
    resources.srcDir(compileCli.map { it.classes })
}

dependencies {
    compileOnly(files(compileCli.map { it.classes }))
}

/*
 * One file with everything in it, so `java -jar lotek.jar` is the whole
 * installation. The plain jar is without the dependencies, and is the one
 * the Gradle plugin uses.
 */
val fatJar = tasks.register<Jar>("fatJar") {
    archiveFileName.set("lotek.jar")
    manifest { attributes("Main-Class" to "no.lotek.cli.MainKt") }
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from(sourceSets.main.map { it.output })
    from(configurations.runtimeClasspath.map { classpath -> classpath.map { zipTree(it) } })
    exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/versions/**/module-info.class", "module-info.class")
}

tasks.assemble { dependsOn(fatJar) }
