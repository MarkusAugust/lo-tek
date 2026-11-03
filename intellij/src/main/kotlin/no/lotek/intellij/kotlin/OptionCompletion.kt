package no.lotek.intellij.kotlin

import com.intellij.codeInsight.completion.CompletionContributor
import com.intellij.codeInsight.completion.CompletionParameters
import com.intellij.codeInsight.completion.CompletionResultSet
import com.intellij.codeInsight.lookup.LookupElement
import com.intellij.codeInsight.lookup.LookupElementDecorator
import com.intellij.codeInsight.lookup.LookupElementPresentation
import com.intellij.psi.util.PsiTreeUtil
import no.lotek.BuilderOption
import no.lotek.Lotek
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtValueArgumentList

/**
 * The description of each option next to it, when the Kotlin plugin offers the
 * options of a builder function as named arguments: `variant =` with "How
 * weighty the action is. Default: primary".
 *
 * Kotlin already offers the options, and the values of an option without the
 * type name (`PlatformCompletionTest`), so this adds to its suggestions and
 * never removes one: every result from the other contributors is passed on,
 * a named argument of a builder function with a description added to it.
 *
 * The descriptions are from the manifest in the plugin. A project on another
 * version of LO-TEK can have an option the plugin does not know, and that one
 * is shown as Kotlin shows it.
 */
class OptionCompletion : CompletionContributor() {
    override fun fillCompletionVariants(parameters: CompletionParameters, result: CompletionResultSet) {
        val options = optionsAt(parameters) ?: return
        result.runRemainingContributors(parameters) { r ->
            val option = options[r.lookupElement.lookupString.removeSuffix(" =").takeIf { r.lookupElement.lookupString.endsWith(" =") }]
            result.passResult(if (option == null) r else r.withLookupElement(Described(r.lookupElement, summary(option))))
        }
    }

    /** The options of the builder function whose argument list the caret is in, by name. */
    private fun optionsAt(parameters: CompletionParameters): Map<String, BuilderOption>? {
        // The original file, not the copy completion works in: the copy has a
        // marker at the caret, and its references do not always resolve.
        val at = parameters.originalFile.findElementAt(parameters.offset) ?: parameters.originalFile.findElementAt(parameters.offset - 1)
        val list = PsiTreeUtil.getParentOfType(at, KtValueArgumentList::class.java, false) ?: return null
        val call = list.parent as? KtCallExpression ?: return null
        val name = call.calledName()?.removePrefix("no.lotek.Lt.")?.takeIf { '.' !in it } ?: return null
        return Lotek.manifest.builders.firstOrNull { it.name == name }?.options?.associateBy { it.name }
    }

    private class Described(delegate: LookupElement, private val summary: String) : LookupElementDecorator<LookupElement>(delegate) {
        override fun renderElement(presentation: LookupElementPresentation) {
            super.renderElement(presentation)
            presentation.appendTailText("  $summary", true)
        }
    }

    companion object {
        /** The description without code marks, cut at about 80 characters. */
        internal fun summary(option: BuilderOption): String {
            val text = option.description.orEmpty().replace("`", "")
            return if (text.length <= 80) text else text.take(79).substringBeforeLast(' ') + "…"
        }
    }
}
