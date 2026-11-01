package no.lotek.html

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFailsWith
import kotlinx.html.FormMethod
import kotlinx.html.body
import kotlinx.html.button
import kotlinx.html.div
import kotlinx.html.form
import kotlinx.html.h2
import kotlinx.html.h3
import kotlinx.html.head
import kotlinx.html.html
import kotlinx.html.input
import kotlinx.html.label
import kotlinx.html.li
import kotlinx.html.link
import kotlinx.html.p
import kotlinx.html.span
import kotlinx.html.stream.createHTML
import kotlinx.html.title
import kotlinx.html.ul
import no.lotek.ButtonVariant
import no.lotek.Lt
import no.lotek.LotekWebJar
import no.lotek.InputType
import no.lotek.RequiredMarker
import no.lotek.assertLotek
import no.lotek.errorSummary
import no.lotek.field

/**
 * That a page built with kotlinx.html and LO-TEK's builder functions is
 * correct markup, checked by the same core as `lotek check`.
 */
class LtTest {
    /** A job order with an error in the fixer's address, as a Ktor app would render it. */
    private fun jobOrder(invalid: Boolean): String =
        createHTML().html {
            head {
                title("Job order")
                link(rel = "stylesheet", href = LotekWebJar.CSS)
            }
            body {
                form(action = "/jobs", method = FormMethod.post) {
                    val summary = Lt.errorSummary(count = if (invalid) 1 else 0, id = "errors")
                    div { lt(summary.host)
                        h2 { lt(summary.title); +"Fix 1 error" }
                        ul { li { +"The fixer's address is missing @" } }
                    }
                    val field = Lt.field(id = "fixer", required = RequiredMarker.TEXT, help = true, error = true, invalid = invalid)
                    label { lt(field.label); +"Fixer's address" }
                    input { lt(Lt.input(type = InputType.EMAIL, state = field.state), field.control); name = "fixer" }
                    p { lt(Lt.helpText(), field.help); +"The board writes to the fixer, never to the crew." }
                    p { lt(Lt.errorText(), field.error); +"Enter a valid address." }
                    button { lt(Lt.button()); +"Order the job" }
                    button { lt(Lt.button(variant = ButtonVariant.SECONDARY)); +"Save draft" }
                }
            }
        }

    @Test
    fun `the page is correct markup, with and without errors`() {
        assertLotek(jobOrder(invalid = false))
        assertLotek(jobOrder(invalid = true))
    }

    @Test
    fun `the wiring between label, field and error text is in the HTML`() {
        val html = jobOrder(invalid = true)
        assertContains(html, """for="fixer"""")
        assertContains(html, """aria-describedby="fixer-help fixer-error"""")
        assertContains(html, """aria-invalid="true"""")
    }

    @Test
    fun `the classes are added to the ones the tag has`() {
        val html = createHTML().div(classes = "my-own") { lt(Lt.card(), mapOf("class" to "my-own extra")) }
        assertContains(html, """class="my-own lt-card extra"""")
    }

    @Test
    fun `the parts the template writes itself have their classes on the builder function`() {
        // `lt-card__title` used to be a string in every Kotlin template, since
        // only TypeScript had `lt.card.title`.
        val html = createHTML().div {
            lt(Lt.card())
            h3 { lt(Lt.card.title); +"Claim AV-2079-0481" }
        }
        assertContains(html, """<h3 class="lt-card__title">""")
        assertLotek(html, fragment = true)
    }

    @Test
    fun `a typo in a custom class is caught by the check`() {
        val html = createHTML().span { lt(Lt.badge(), mapOf("class" to "lt-badg")); +"New" }
        assertFailsWith<AssertionError> { assertLotek(html, fragment = true) }
    }
}
