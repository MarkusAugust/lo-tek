package no.lotek.html

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.html.FlowContent
import kotlinx.html.a
import kotlinx.html.dd
import kotlinx.html.div
import kotlinx.html.dl
import kotlinx.html.dt
import kotlinx.html.id
import kotlinx.html.p
import kotlinx.html.stream.createHTML
import no.lotek.Lotek
import no.lotek.Lt

class ElementsTest {
    private val functions: List<FlowContent.() -> Unit> = listOf(
        { ltField() },
        { ltTabs() },
        { ltErrorSummary() },
        { ltPopover() },
        { ltTerm() },
        { ltSuggestion() },
        { ltDialog() },
        { ltToast() },
        { ltSessionTimeout() },
        { ltConnectionStatus() },
    )

    @Test
    fun `there is one function per element in the manifest, and no other`() {
        val tags = functions.map { f ->
            val html = createHTML(prettyPrint = false).div { f() }
            Regex("^<div><(lt-[a-z-]+)></\\1></div>$").find(html)?.groupValues?.get(1)
                ?: error("Not one empty element: $html")
        }
        assertEquals(Lotek.manifest.elements.keys.sorted(), tags.sorted())
    }

    @Test
    fun `a term stands in a paragraph, with the link from the builder function in it`() {
        val term = Lt.term(id = "term-signal")
        val html = createHTML(prettyPrint = false).p {
            +"Datastar keeps "
            ltTerm { a { lt(term.word); +"signals" } }
        }
        assertEquals(
            "<p>Datastar keeps <lt-term><a class=\"lt-term\" href=\"#term-signal\" aria-details=\"term-signal\">signals</a></lt-term></p>",
            html,
        )
    }

    @Test
    fun `a glossary entry puts the dt and the dd in the div`() {
        val term = Lt.term(id = "term-signal")
        val html = createHTML(prettyPrint = false).dl {
            ltTermEntry(term.entry) {
                dt { +"Signal" }
                dd { +"A value." }
            }
        }
        assertEquals(
            "<dl><div class=\"lt-term__entry\" id=\"term-signal\"><dt>Signal</dt><dd>A value.</dd></div></dl>",
            html,
        )
    }

    @Test
    fun `the element takes attributes, builder functions and flow content`() {
        val html = createHTML(prettyPrint = false).div {
            ltSessionTimeout {
                id = "session"
                lt(Lt.sessionTimeout(titleId = "session-title").host)
                p { +"Your session is ending" }
            }
        }
        assertEquals(
            "<div><lt-session-timeout id=\"session\" class=\"lt-session-timeout\" data-ignore-morph=\"\">" +
                "<p>Your session is ending</p></lt-session-timeout></div>",
            html,
        )
    }
}
