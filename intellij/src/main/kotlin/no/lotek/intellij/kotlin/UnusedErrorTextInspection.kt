package no.lotek.intellij.kotlin

import com.intellij.codeInspection.LocalInspectionTool
import com.intellij.codeInspection.ProblemHighlightType
import com.intellij.codeInspection.ProblemsHolder
import com.intellij.psi.PsiElementVisitor
import com.intellij.psi.util.PsiTreeUtil
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtConstantExpression
import org.jetbrains.kotlin.psi.KtDotQualifiedExpression
import org.jetbrains.kotlin.psi.KtNameReferenceExpression
import org.jetbrains.kotlin.psi.KtVisitorVoid

/**
 * `Lt.field(error = true)` where `field.error` is never put on an element. The
 * field then points at an error text with `aria-describedby` when it is
 * invalid, and the error text the template writes has no id, so the screen
 * reader is told about an error it cannot find.
 *
 * It looks only in the function the call stands in, and is silent when the
 * answer goes anywhere else whole: passed to another function, returned or
 * put in a collection, where the error text may well be written.
 */
class UnusedErrorTextInspection : LocalInspectionTool() {
    override fun buildVisitor(holder: ProblemsHolder, isOnTheFly: Boolean): PsiElementVisitor =
        object : KtVisitorVoid() {
            override fun visitCallExpression(call: KtCallExpression) {
                val builder = call.builderName() ?: return
                if (builder != "field" && builder != "suggestion") return
                val error = call.valueArguments.firstOrNull { it.getArgumentName()?.asName?.asString() == "error" } ?: return
                if ((error.getArgumentExpression() as? KtConstantExpression)?.text != "true") return
                val variable = call.assignedTo() ?: return
                val function = call.enclosingFunction() ?: return
                // By name first, so only the references that can be the variable are resolved.
                val uses = PsiTreeUtil.findChildrenOfType(function, KtNameReferenceExpression::class.java)
                    .filter { it.getReferencedName() == variable.name && it.target() == variable }
                if (uses.isEmpty()) return
                for (use in uses) {
                    val qualified = use.parent as? KtDotQualifiedExpression
                    // Anything but `field.something` means the answer goes on elsewhere.
                    if (qualified == null || qualified.receiverExpression != use) return
                    if (qualified.selectorExpression?.text == "error") return
                }
                holder.registerProblem(
                    error,
                    "error = true, but ${variable.name}.error is never put on an element, so the error text the field points at has no id",
                    ProblemHighlightType.WEAK_WARNING,
                )
            }
        }
}
