package no.lotek.html

import kotlinx.html.DL
import kotlinx.html.FlowContent
import kotlinx.html.FlowOrPhrasingContent
import kotlinx.html.HTMLTag
import kotlinx.html.HtmlBlockTag
import kotlinx.html.HtmlInlineTag
import kotlinx.html.TagConsumer
import kotlinx.html.div
import kotlinx.html.visit

/**
 * A LO-TEK web component, such as `<lt-field>`, as a tag in kotlinx.html.
 *
 * kotlinx.html knows only the elements in HTML, so without this a template
 * wrote `HTMLTag("lt-tabs", consumer, emptyMap(), null, false, false)`. The
 * content is flow content, as in a `<div>`, and the attributes are set as on
 * any tag: `ltTabs { id = "claim-tabs" }`, or with [lt] from a builder function.
 */
class LtElement(tagName: String, consumer: TagConsumer<*>) :
    HTMLTag(tagName, consumer, emptyMap(), null, inlineTag = false, emptyTag = false),
    HtmlBlockTag

private fun FlowContent.element(tagName: String, block: LtElement.() -> Unit) =
    LtElement(tagName, consumer).visit(block)

/** `<lt-field>`: wires the label, the control, the help text and the error text it contains. */
fun FlowContent.ltField(block: LtElement.() -> Unit = {}) = element("lt-field", block)

/** `<lt-tabs>`: the tabs over the links in `.lt-tabs__list` and the panels they point to. */
fun FlowContent.ltTabs(block: LtElement.() -> Unit = {}) = element("lt-tabs", block)

/** `<lt-error-summary>`: the box above a form, which takes focus when it is shown. */
fun FlowContent.ltErrorSummary(block: LtElement.() -> Unit = {}) = element("lt-error-summary", block)

/** `<lt-popover>`: a button and the panel it opens. */
fun FlowContent.ltPopover(block: LtElement.() -> Unit = {}) = element("lt-popover", block)

/**
 * A LO-TEK web component that stands in running text, such as `<lt-term>`.
 * It is phrasing content, so it can go in a `p`, and holds phrasing content.
 */
class LtInlineElement(tagName: String, consumer: TagConsumer<*>) :
    HTMLTag(tagName, consumer, emptyMap(), null, inlineTag = true, emptyTag = false),
    HtmlInlineTag

/** `<lt-term>`: a word in the text that shows its glossary entry in a card by the word. */
fun FlowOrPhrasingContent.ltTerm(block: LtInlineElement.() -> Unit = {}) =
    LtInlineElement("lt-term", consumer).visit(block)

/**
 * A glossary entry in a `dl`: the `div` around a `dt` and its `dd`, with the
 * set from `Lt.term().entry` on it. kotlinx.html allows `dt` and `dd` only
 * directly in `dl`, so `div { dt { } }` does not compile. Here the block has
 * the `dl` as its receiver, and the `dt` and `dd` it writes land in the `div`.
 *
 * ```kotlin
 * dl { ltTermEntry(signal.entry) { dt { +"Signal" }; dd { +"A value." } } }
 * ```
 */
fun DL.ltTermEntry(entry: Map<String, String>, block: DL.() -> Unit) {
    val list = this
    div {
        lt(entry)
        list.block()
    }
}

/** `<lt-suggestion>`: a field with a suggestion list. */
fun FlowContent.ltSuggestion(block: LtElement.() -> Unit = {}) = element("lt-suggestion", block)

/** `<lt-dialog>`: opens the `<dialog>` inside it as a modal when it has `open`. */
fun FlowContent.ltDialog(block: LtElement.() -> Unit = {}) = element("lt-dialog", block)

/** `<lt-toast>`: the region the messages from `showToast` are written into. */
fun FlowContent.ltToast(block: LtElement.() -> Unit = {}) = element("lt-toast", block)

/** `<lt-session-timeout>`: the warning before a signed-in session expires. */
fun FlowContent.ltSessionTimeout(block: LtElement.() -> Unit = {}) = element("lt-session-timeout", block)

/** `<lt-connection-status>`: the bar that says the connection is lost. */
fun FlowContent.ltConnectionStatus(block: LtElement.() -> Unit = {}) = element("lt-connection-status", block)
