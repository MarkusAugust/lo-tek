package no.lotek.intellij.kotlin

import com.intellij.codeInspection.LocalInspectionTool
import com.intellij.codeInspection.LocalQuickFix
import com.intellij.codeInspection.ProblemDescriptor
import com.intellij.codeInspection.ProblemsHolder
import com.intellij.openapi.project.Project
import com.intellij.psi.PsiElementVisitor
import com.intellij.psi.SmartPointerManager
import com.intellij.psi.util.PsiTreeUtil
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtPsiFactory
import org.jetbrains.kotlin.psi.KtValueArgument
import org.jetbrains.kotlin.psi.KtVisitorVoid

/**
 * A set from a builder function on an element its part cannot be:
 * `label { lt(field.control) }`, where `field.control` belongs on the
 * `<input>`. The component finds its parts by the selectors in the manifest,
 * so on the wrong element the wiring points at something that is not the
 * field, and the screen reader gets a label without a field.
 *
 * It is silent whenever the code does not say it for certain: a tag it cannot
 * read (a lambda of `with`, `apply` or a helper of the app), a set it cannot
 * resolve, and a part whose selector matches by a class or a role in some
 * alternative, since the set itself may write that class. The parts it can
 * judge are those whose selector names a tag in every alternative, such as
 * the label and the control of a field and the title of a dialog.
 *
 * The quick fix moves the set when exactly one other `lt(…)` in the same
 * function stands in a tag the part allows.
 */
class WrongElementInspection : LocalInspectionTool() {
    override fun buildVisitor(holder: ProblemsHolder, isOnTheFly: Boolean): PsiElementVisitor =
        object : KtVisitorVoid() {
            override fun visitCallExpression(call: KtCallExpression) {
                if (!call.isLt()) return
                val tag = call.enclosingTag() ?: return
                for (argument in call.valueArguments) {
                    val expression = argument.getArgumentExpression() ?: continue
                    val set = expression.setOfBuilder() ?: continue
                    val placement = set.placement() ?: continue
                    if (tag in placement.tags) continue
                    val allowed = placement.tags.joinToString(" or ") { "<$it>" }
                    val target = target(call, placement.tags, set)
                    holder.registerProblem(
                        expression,
                        "${set.builder}.${set.field} goes on $allowed, the ${placement.part} of <${placement.element}>, not on <$tag>",
                        *listOfNotNull(target?.let { MoveSet(argument, it) }).toTypedArray(),
                    )
                }
            }
        }

    /**
     * The one other `lt(…)` in the function that stands in an allowed tag and
     * carries no set from another answer, or `null` when there is none or more
     * than one. With two fields in one function, the `<input>` that already
     * has `b.control` is not where `a.control` goes.
     */
    private fun target(from: KtCallExpression, tags: List<String>, set: SetOfBuilder): KtCallExpression? {
        val answer = set.answer()
        // A name that does not resolve, in code half written, says nothing for certain.
        if (set.receiver != null && answer == null) return null
        val function = from.enclosingFunction() ?: return null
        return PsiTreeUtil.findChildrenOfType(function, KtCallExpression::class.java)
            .filter { it != from && it.isLt() && it.enclosingTag() in tags }
            .filter { candidate ->
                // A set read from something other than a name cannot be told
                // apart from another answer's, so then only an element with no
                // set from a builder function with several sets will do.
                val others = candidate.valueArguments.mapNotNull { it.getArgumentExpression()?.setOfBuilder() }
                if (answer == null) others.isEmpty() else others.all { it.answer() == answer }
            }
            .singleOrNull()
    }

    private class MoveSet(argument: KtValueArgument, target: KtCallExpression) : LocalQuickFix {
        private val argument = SmartPointerManager.createPointer(argument)
        private val target = SmartPointerManager.createPointer(target)

        override fun getFamilyName() = "Move the set to the element it belongs on"

        override fun applyFix(project: Project, descriptor: ProblemDescriptor) {
            val argument = argument.element ?: return
            val target = target.element ?: return
            val text = argument.getArgumentExpression()?.text ?: return
            val from = PsiTreeUtil.getParentOfType(argument, KtCallExpression::class.java) ?: return
            target.valueArgumentList?.addArgument(KtPsiFactory(project).createArgument(text))
            // `lt(field.control)` with nothing left is removed whole, rather than left as `lt()`.
            if (from.valueArguments.size == 1) from.delete() else from.valueArgumentList?.removeArgument(argument)
        }
    }
}
