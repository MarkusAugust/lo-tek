import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

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
    testImplementation("org.jsoup:jsoup:1.24.1")
    // Reads the answers in the build cases, for the attributes a builder function can write.
    testImplementation("com.google.code.gson:gson:2.11.0")
}

/*
 * The Kotlin recipes on the component pages, compiled as test sources. The
 * test renders each and compares it with the HTML recipe on the same page,
 * so a kotlinx.html tab that drifts from the page fails here.
 */
val componentPages = rootDir.resolve("../documentation/src/content/docs/components")
val extractRecipes = tasks.register<no.lotek.build.ExtractRecipes>("extractRecipes") {
    recipes.set(rootDir.resolve("../documentation/generated/recipes.json"))
    example.set(rootDir.resolve("../documentation/src/components/Example.astro"))
    sources.set(layout.buildDirectory.dir("generated/recipes/kotlin"))
    resources.set(layout.buildDirectory.dir("generated/recipes/resources"))
}
/*
 * The Kotlin in the rulebook for coding agents, compiled as test sources too.
 * `RulebookTest` renders the blocks and compares the rulebook's names with
 * the package, so an example an agent copies cannot drift from the code.
 */
val rulebookFile = rootDir.resolve("../interfaces/agent/kotlin.md")
val extractRulebook = tasks.register<no.lotek.build.ExtractRulebook>("extractRulebook") {
    rulebook.set(rulebookFile)
    sources.set(layout.buildDirectory.dir("generated/rulebook/kotlin"))
}
sourceSets.test {
    kotlin.srcDir(extractRecipes.map { it.sources })
    resources.srcDir(extractRecipes.map { it.resources })
    kotlin.srcDir(extractRulebook.map { it.sources })
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

tasks.test {
    useJUnitPlatform()
    val interfaces = rootDir.resolve("../interfaces")
    inputs.file(interfaces.resolve("manifest/build-cases.json")).withPathSensitivity(PathSensitivity.NONE)
    systemProperty("buildCases", interfaces.resolve("manifest/build-cases.json").absolutePath)
    // The test counts the kotlinx.html tabs in the pages itself, so a tab `extractRecipes` missed fails it.
    systemProperty("pages", componentPages.absolutePath)
    // The setup `page-setup.ts` writes to `recipes.json`: the Datastar address, the registrations and the order cases.
    val recipesFile = rootDir.resolve("../documentation/generated/recipes.json")
    systemProperty("recipes", recipesFile.absolutePath)
    inputs.file(recipesFile).withPathSensitivity(PathSensitivity.NONE)
    // The rulebook's tables and names, read by `RulebookTest`.
    systemProperty("rulebook", rulebookFile.absolutePath)
    inputs.file(rulebookFile).withPathSensitivity(PathSensitivity.NONE)
    inputs.dir(componentPages).withPathSensitivity(PathSensitivity.RELATIVE)
    testLogging { events("failed") }
}
