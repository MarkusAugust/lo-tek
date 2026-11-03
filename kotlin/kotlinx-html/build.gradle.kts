import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm")
}

// Same version and group as the main package: io.github.markusaugust:lo-tek-kotlinx-html.
group = rootProject.group
version = rootProject.version
base.archivesName = "lo-tek-kotlinx-html"

repositories {
    mavenCentral()
}

dependencies {
    api(project(":"))
    api("org.jetbrains.kotlinx:kotlinx-html-jvm:0.12.0")
    testImplementation(kotlin("test"))
    // Parses the rendered recipes and the HTML recipes the same way, so the two can be compared as trees.
    testImplementation("org.jsoup:jsoup:1.22.2")
    // Reads the answers in the build cases, for the attributes a builder function can write.
    testImplementation("com.google.code.gson:gson:2.11.0")
}

/*
 * The Kotlin recipes on the component pages, compiled as test sources. The
 * test renders each and compares it with the HTML recipe on the same page,
 * so a Kotlin tab that drifts from the page fails here.
 */
val componentPages = rootDir.resolve("../documentation/src/content/docs/components")
val extractRecipes = tasks.register<no.lotek.build.ExtractRecipes>("extractRecipes") {
    this.pages.from(fileTree(componentPages) { include("*.mdx") })
    sources.set(layout.buildDirectory.dir("generated/recipes/kotlin"))
    resources.set(layout.buildDirectory.dir("generated/recipes/resources"))
}
sourceSets.test {
    kotlin.srcDir(extractRecipes.map { it.sources })
    resources.srcDir(extractRecipes.map { it.resources })
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.test {
    useJUnitPlatform()
    val interfaces = rootDir.resolve("../interfaces")
    inputs.file(interfaces.resolve("manifest/build-cases.json")).withPathSensitivity(PathSensitivity.NONE)
    systemProperty("buildCases", interfaces.resolve("manifest/build-cases.json").absolutePath)
    // The test counts the Kotlin tabs in the pages itself, so a tab `extractRecipes` missed fails it.
    systemProperty("pages", componentPages.absolutePath)
    inputs.dir(componentPages).withPathSensitivity(PathSensitivity.RELATIVE)
    testLogging { events("failed") }
}
