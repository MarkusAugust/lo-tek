package no.lotek.intellij

import com.intellij.codeInsight.completion.CompletionContributor
import com.intellij.codeInsight.completion.CompletionParameters
import com.intellij.codeInsight.completion.CompletionResultSet
import com.intellij.codeInsight.completion.CompletionType
import com.intellij.codeInsight.lookup.LookupElementBuilder
import com.intellij.icons.AllIcons
import no.lotek.SuggestionKind

/**
 * Suggests LO-TEK's classes inside `class="…"`, and the values of an
 * attribute a class on the tag or an `<lt-…>` element takes.
 *
 * Registered on the HTML language, not on Kotlin. When IntelliJ injects HTML
 * into a string, the fragment becomes a real `PsiFile` with the HTML
 * language, and this is called for it. The same registration therefore
 * covers ordinary `.html` files, Kotlin strings and TypeScript strings.
 *
 * That is exactly the gap the plugin exists for: `web-types.json` gives
 * completion in HTML files without any plugin, but is not read into
 * injected fragments.
 *
 * Where the caret is, and what there is to write there, is the core's
 * answer, see [Editing]: the same one the language server gives. The core
 * reads the text backwards from the caret and not a tree, so a tag that is
 * not closed while you type, like `<table class="lt-`, is read the same.
 */
class LotekCompletionContributor : CompletionContributor() {
    override fun fillCompletionVariants(
        parameters: CompletionParameters,
        result: CompletionResultSet,
    ) {
        if (parameters.completionType != CompletionType.BASIC) return

        val file = parameters.originalFile
        /*
         * The prefix is IntelliJ's own, so every suggestion is handed over
         * and the IDE filters on what is typed: tested in an attribute value,
         * `class="my-own lt-but` completes to `lt-button`.
         *
         * The names of the elements and their attributes are left to the
         * IDE, which has them from `web-types.json`.
         */
        for (suggestion in Editing.complete(file, file.text, parameters.offset)) {
            val icon =
                when (suggestion.kind) {
                    SuggestionKind.CLASS -> AllIcons.Xml.Css_class
                    SuggestionKind.VALUE -> AllIcons.Nodes.Enum
                    SuggestionKind.ELEMENT, SuggestionKind.ATTRIBUTE -> continue
                }
            result.addElement(
                LookupElementBuilder.create(suggestion.label)
                    .withIcon(icon)
                    .withTypeText(suggestion.detail, true)
                    .withCaseSensitivity(false),
            )
        }
    }
}
