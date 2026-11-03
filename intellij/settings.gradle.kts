rootProject.name = "lo-tek-intellij"

// LO-TEK for Kotlin, built from the source next to it. The diagnostics
// come from the Rust core in that package.
includeBuild("../kotlin") {
    // The kotlinx.html module is called `kotlinx-html` in the build and
    // `lo-tek-kotlinx-html` as an artifact, so it is named here. With a rule
    // of its own Gradle no longer substitutes by name, so the root project is
    // named too, or the plugin is built against the release on Maven Central.
    dependencySubstitution {
        substitute(module("io.github.markusaugust:lo-tek-interfaces")).using(project(":"))
        substitute(module("io.github.markusaugust:lo-tek-kotlinx-html")).using(project(":kotlinx-html"))
    }
}
