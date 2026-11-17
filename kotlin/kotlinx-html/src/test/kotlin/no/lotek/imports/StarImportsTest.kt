package no.lotek.imports

import kotlin.test.Test
import kotlin.test.assertContains
import kotlinx.html.*
import kotlinx.html.stream.createHTML
import no.lotek.*
import no.lotek.html.lt

/*
 * The recipes import kotlinx.html and LO-TEK with a star each. A name both
 * packages have is then ambiguous, and an extension on kotlinx.html's `Tag`,
 * the commonest helper in a kotlinx.html app, stops compiling. This file
 * compiles only while no.lotek has no such name.
 */
private fun Tag.marked() {
    attributes["data-marked"] = ""
}

class StarImportsTest {
    @Test
    fun `kotlinx html and LO-TEK can both be imported with a star`() {
        val html = createHTML().button { lt(Lt.button()); marked(); +"Order" }
        assertContains(html, "data-marked")
    }
}
