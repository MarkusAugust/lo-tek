package no.lotek.intellij

import com.intellij.psi.PsiFile
import no.lotek.Hover
import no.lotek.Lotek
import no.lotek.Suggestion

/**
 * What the core suggests at a place in a file, and what it says about the
 * class there: the two questions the language server answers
 * `textDocument/completion` and `textDocument/hover` with.
 *
 * Against the project's manifest when it has one, otherwise the manifest in
 * the Kotlin package, the same one [LotekAnnotator] checks against and found
 * the same way, see [ProjectManifest]. Completion therefore never suggests a
 * class the diagnostics reject, and it suggests the classes in components the
 * project has taken over. A manifest the core cannot read gives a warning in
 * the log and the answer for the package's.
 */
internal object Editing {
    fun complete(file: PsiFile, text: String, offset: Int): List<Suggestion> =
        ask(file) { manifest -> Lotek.complete(text, offset, manifest = manifest) }

    fun hover(file: PsiFile, text: String, offset: Int): Hover? =
        ask(file) { manifest -> Lotek.hover(text, offset, manifest = manifest) }

    private fun <T> ask(file: PsiFile, question: (manifest: String?) -> T): T {
        val manifest = ProjectManifest.forFile(file) ?: return question(null)
        return try {
            question(manifest)
        } catch (unreadable: IllegalArgumentException) {
            ProjectManifest.rejectedBy(manifest, unreadable.message.orEmpty())
            question(null)
        }
    }
}
