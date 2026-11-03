// The build logic for the Kotlin package: the generator that reads the manifest.
plugins {
    `kotlin-dsl`
}

repositories {
    mavenCentral()
}

dependencies {
    // Turns the WebAssembly module into JVM bytecode when the package is built.
    implementation("com.dylibso.chicory:build-time-compiler:1.7.5")
}

dependencies {
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    testLogging { events("failed") }
}
