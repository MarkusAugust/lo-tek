package no.lotek.intellij.kotlin

import com.intellij.codeInspection.LocalInspectionTool
import com.intellij.codeInspection.LocalQuickFix
import com.intellij.codeInspection.ProblemDescriptor
import com.intellij.codeInspection.ProblemsHolder
import com.intellij.openapi.project.Project
import com.intellij.psi.PsiElementVisitor
import org.jetbrains.kotlin.lexer.KtTokens
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtDotQualifiedExpression
import org.jetbrains.kotlin.psi.KtPostfixExpression
import org.jetbrains.kotlin.psi.KtPsiFactory
import org.jetbrains.kotlin.psi.KtVisitorVoid

/**
 * `ButtonVariant.of(value)!!`, where the text comes from outside: a form, a
 * query string or a Datastar signal. `of` gives `null` for a text that is not
 * an allowed value, and `!!` turns that into a `NullPointerException` that
 * says nothing about the value.
 *
 * The quick fix throws with the value and the type in the message. It does
 * not fall back on a default: `InputState.of("Invalid") ?: DEFAULT` renders a
 * field the server thinks is invalid as valid, and nobody sees it.
 */
class UnknownValueInspection : LocalInspectionTool() {
    override fun buildVisitor(holder: ProblemsHolder, isOnTheFly: Boolean): PsiElementVisitor =
        object : KtVisitorVoid() {
            override fun visitPostfixExpression(expression: KtPostfixExpression) {
                if (expression.operationToken != KtTokens.EXCLEXCL) return
                val type = lookupType(expression) ?: return
                holder.registerProblem(
                    expression.operationReference,
                    "$type.of(…)!! throws a NullPointerException that does not say which value was not a $type",
                    ThrowWithValue(type),
                )
            }
        }

    private class ThrowWithValue(private val type: String) : LocalQuickFix {
        override fun getFamilyName() = "Throw with the value in the message"

        override fun applyFix(project: Project, descriptor: ProblemDescriptor) {
            val expression = descriptor.psiElement.parent as? KtPostfixExpression ?: return
            val lookup = expression.baseExpression ?: return
            val call = (lookup as? KtDotQualifiedExpression)?.selectorExpression as? KtCallExpression ?: return
            val value = call.valueArguments.singleOrNull()?.getArgumentExpression()?.text ?: return
            // `?:` binds looser than a call or an operator. Kotlin's `replace`
            // adds the parentheses where the `!!` was a receiver or an operand,
            // which the test of `.value` after it checks.
            expression.replace(KtPsiFactory(project).createExpression("${lookup.text} ?: error(\"Not a $type: \${$value}\")"))
        }
    }

    companion object {
        /** `ButtonVariant` when the expression is `ButtonVariant.of(…)!!` with LO-TEK's `of`, otherwise `null`. */
        internal fun lookupType(expression: KtPostfixExpression): String? {
            val call = (expression.baseExpression as? KtDotQualifiedExpression)?.selectorExpression as? KtCallExpression ?: return null
            val name = call.calledName() ?: return null
            return Regex("""^no\.lotek\.(\w+)\.Companion\.of$""").find(name)?.groupValues?.get(1)
        }
    }
}
