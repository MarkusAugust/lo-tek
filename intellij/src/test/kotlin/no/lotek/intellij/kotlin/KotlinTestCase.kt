package no.lotek.intellij.kotlin

import com.intellij.openapi.module.Module
import com.intellij.openapi.projectRoots.JavaSdk
import com.intellij.openapi.projectRoots.Sdk
import com.intellij.openapi.roots.ContentEntry
import com.intellij.openapi.roots.ModifiableRootModel
import com.intellij.openapi.roots.OrderRootType
import com.intellij.openapi.vfs.JarFileSystem
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.testFramework.LightProjectDescriptor
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.io.File

/**
 * A light Kotlin project with LO-TEK, kotlinx.html and the standard library as
 * a library, the jars Gradle resolved, so the code in a test file resolves as
 * it does in an app. An inspection that stays silent on what it cannot
 * resolve would otherwise pass every test without having looked at anything.
 */
abstract class KotlinTestCase : BasePlatformTestCase() {
    override fun getProjectDescriptor(): LightProjectDescriptor = Descriptor

    private object Descriptor : LightProjectDescriptor() {
        // The JDK the tests run on, so `java.util.UUID` and `System.nanoTime` resolve.
        override fun getSdk(): Sdk = JavaSdk.getInstance().createJdk("jdk", System.getProperty("java.home"), false)

        override fun configureModule(module: Module, model: ModifiableRootModel, contentEntry: ContentEntry) {
            super.configureModule(module, model, contentEntry)
            val jars = System.getProperty("lotek.kotlinLibraries").orEmpty().split(File.pathSeparator).filter { it.isNotEmpty() }
            check(jars.size == 4) { "Expected four libraries for the Kotlin test project, got $jars" }
            val library = model.moduleLibraryTable.createLibrary("lotek")
            val edit = library.modifiableModel
            for (jar in jars) {
                val file = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(File(jar)) ?: error("No such jar: $jar")
                edit.addRoot(JarFileSystem.getInstance().getJarRootForLocalFile(file)!!, OrderRootType.CLASSES)
            }
            edit.commit()
        }
    }

    /**
     * What [inspection] reports in the file, as the text it is on and the
     * message. Kotlin's own errors are left out, but an unresolved name would
     * make the inspection silent, so the file must have none: that is checked
     * too, or a test of silence could pass on code that does not compile.
     */
    protected fun problems(inspection: com.intellij.codeInspection.LocalInspectionTool): List<Pair<String, String>> {
        myFixture.enableInspections(inspection)
        val highlights = myFixture.doHighlighting()
        val errors = highlights.filter { it.severity == com.intellij.lang.annotation.HighlightSeverity.ERROR }
        assertTrue("the test file does not compile: ${errors.map { it.description }}", errors.isEmpty())
        val name = inspection.shortName
        return highlights.filter { it.inspectionToolId == name }.map { it.text to it.description }
    }

    /** A Kotlin file with the imports a kotlinx.html template has, and [body] after them. */
    protected fun kotlin(body: String) =
        myFixture.configureByText(
            "Page.kt",
            """
            |import kotlinx.html.*
            |import no.lotek.*
            |import no.lotek.InputType
            |import no.lotek.html.*
            |
            |$body
            """.trimMargin(),
        )
}
