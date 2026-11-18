package no.lotek.intellij.kotlin

import junit.framework.TestCase
import no.lotek.Lotek

/**
 * [tagsOf] reads the tags a part can be on out of its selector, and
 * [WrongElementInspection] trusts the answer. The selectors are written for
 * the components, which find their parts with `querySelector`, so nothing
 * keeps a new one in a form [tagsOf] reads rightly.
 *
 * Here every selector of a part in the manifest has its answer written out
 * by hand: the tags, or `null` when an alternative names no tag, and the set
 * may then stand on any. A selector that is not in the list stops the test
 * until someone has said what it gives.
 */
class TagsOfTest : TestCase() {
    private val expected: Map<String, List<String>?> =
        mapOf(
            ".lt-dialog__body" to null,
            ".lt-error-text" to null,
            ".lt-help-text" to null,
            ".lt-session-timeout__count" to null,
            ".lt-session-timeout__text" to null,
            ".lt-suggestion__empty" to null,
            ":scope > dialog" to listOf("dialog"),
            "[popover], .lt-popover" to null,
            "[role='combobox'], input:not([type='hidden'])" to null,
            "[role='listbox'], .lt-suggestion__list" to null,
            "[role='option'], .lt-suggestion__list > li:not([role])" to null,
            "[role='status']" to null,
            "[role='tablist'], .lt-tabs__list" to null,
            "[role='tabpanel'], .lt-tabs__panel:not([role])" to null,
            "a[href^='#']" to listOf("a"),
            "a[role='tab'][href^='#'], .lt-tabs__list a[href^='#']:not([role])" to listOf("a"),
            "button, [role='button']" to null,
            "dialog" to listOf("dialog"),
            "form[method=\"dialog\" i] button" to listOf("button"),
            "h1, h2, h3, h4, h5, h6" to listOf("h1", "h2", "h3", "h4", "h5", "h6"),
            "input.lt-suggestion__value" to listOf("input"),
            "input:not([type='hidden']), textarea, select" to listOf("input", "textarea", "select"),
            "label" to listOf("label"),
            "li a[href^='#']" to listOf("a"),
        )

    private val selectors =
        Lotek.manifest.elements.values
            .flatMap { it.parts.values }
            .map { it.selector }
            .toSet()

    fun `test every selector of a part in the manifest has its tags written out here`() {
        assertEquals(
            "A selector here that no part has, or a part's selector with no answer here.",
            expected.keys.sorted(),
            selectors.sorted(),
        )
    }

    fun `test the tags read from each selector are the ones written out`() {
        for ((selector, tags) in expected) assertEquals(selector, tags, tagsOf(selector))
    }
}
