package no.lotek.intellij.kotlin

import com.intellij.psi.util.PsiTreeUtil
import org.jetbrains.kotlin.psi.KtCallExpression

/**
 * That the test project resolves LO-TEK, kotlinx.html and the standard
 * library. Every other Kotlin test stands on this one.
 */
class ResolveTest : KotlinTestCase() {
    fun `test a call to a builder function resolves to the member of Lt`() {
        val file = kotlin(
            """
            fun FlowContent.form() {
                val field = Lt.field(id = "codename")
                label { lt(field.label); +"Codename" }
                ltField { }
            }
            """.trimIndent(),
        )
        val resolved = PsiTreeUtil.findChildrenOfType(file, KtCallExpression::class.java).map { it.calledName() }
        assertTrue("resolved $resolved", "no.lotek.Lt.field" in resolved)
        assertTrue("resolved $resolved", "no.lotek.html.lt" in resolved)
        assertTrue("resolved $resolved", "kotlinx.html.label" in resolved)
        assertTrue("resolved $resolved", "no.lotek.html.ltField" in resolved)
    }
}
