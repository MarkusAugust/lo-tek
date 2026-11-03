package no.lotek

import java.util.zip.ZipFile
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * The generated `Lt.kt`, with its documentation, is in the sources jar. It
 * is generated into `build/` and not checked in, so without the `srcDir` the
 * jar would have only the handwritten files, and Quick Documentation on
 * `Lt.button(…)` would show nothing.
 */
class SourcesJarTest {
    @Test
    fun `the sources jar has the generated Lt with its documentation`() {
        ZipFile(System.getProperty("sourcesJar")).use { jar ->
            val entry = jar.getEntry("no/lotek/Lt.kt") ?: error("no/lotek/Lt.kt is not in the sources jar: ${jar.entries().toList().map { it.name }.take(20)}")
            val text = jar.getInputStream(entry).bufferedReader().readText()
            assertTrue("@param variant How weighty the action is." in text, "Lt.kt in the sources jar has no KDoc from the manifest")
            assertTrue(jar.getEntry("no/lotek/Handwritten.kt") != null, "Handwritten.kt is not in the sources jar")
        }
    }
}
