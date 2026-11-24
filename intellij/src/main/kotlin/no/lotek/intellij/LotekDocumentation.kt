package no.lotek.intellij

import com.intellij.markdown.utils.doc.DocMarkdownToHtmlConverter
import com.intellij.model.Pointer
import com.intellij.openapi.project.Project
import com.intellij.platform.backend.documentation.DocumentationResult
import com.intellij.platform.backend.documentation.DocumentationTarget
import com.intellij.platform.backend.documentation.DocumentationTargetProvider
import com.intellij.platform.backend.presentation.TargetPresentation
import com.intellij.psi.PsiFile

/**
 * Quick Documentation on an `lt-` class in a class attribute: what the
 * component is, the attributes the class takes and a link to its page.
 *
 * On the HTML language, so it covers HTML injected into a string, like the
 * completion. The text is the core's answer to `hover`, see [Editing], the
 * one the language server shows in other editors. The core writes Markdown,
 * and the IDE shows HTML, so it is converted with the platform's own
 * converter for documentation.
 */
class LotekDocumentationProvider : DocumentationTargetProvider {
    override fun documentationTargets(file: PsiFile, offset: Int): List<DocumentationTarget> {
        val text = file.text
        val hover = Editing.hover(file, text, offset) ?: return emptyList()
        return listOf(ClassDocumentation(file.project, text.substring(hover.start, hover.end), hover.text))
    }
}

/** The documentation of one class. It holds only text, so it is its own pointer. */
private class ClassDocumentation(
    private val project: Project,
    private val name: String,
    private val markdown: String,
) : DocumentationTarget {
    override fun createPointer(): Pointer<out DocumentationTarget> = Pointer.hardPointer(this)

    override fun computePresentation(): TargetPresentation = TargetPresentation.builder(name).presentation()

    override fun computeDocumentation(): DocumentationResult =
        DocumentationResult.documentation(DocMarkdownToHtmlConverter.convert(project, markdown))
}
