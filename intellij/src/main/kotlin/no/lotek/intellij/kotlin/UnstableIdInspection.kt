package no.lotek.intellij.kotlin

import com.intellij.codeInspection.LocalInspectionTool
import com.intellij.codeInspection.ProblemHighlightType
import com.intellij.codeInspection.ProblemsHolder
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiElementVisitor
import com.intellij.psi.util.PsiTreeUtil
import org.jetbrains.kotlin.lexer.KtTokens
import org.jetbrains.kotlin.psi.KtArrayAccessExpression
import org.jetbrains.kotlin.psi.KtBinaryExpression
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtDestructuringDeclaration
import org.jetbrains.kotlin.psi.KtDestructuringDeclarationEntry
import org.jetbrains.kotlin.psi.KtDotQualifiedExpression
import org.jetbrains.kotlin.psi.KtExpression
import org.jetbrains.kotlin.psi.KtForExpression
import org.jetbrains.kotlin.psi.KtFunctionLiteral
import org.jetbrains.kotlin.psi.KtLambdaExpression
import org.jetbrains.kotlin.psi.KtLiteralStringTemplateEntry
import org.jetbrains.kotlin.psi.KtNameReferenceExpression
import org.jetbrains.kotlin.psi.KtNamedFunction
import org.jetbrains.kotlin.psi.KtParameter
import org.jetbrains.kotlin.psi.KtPsiUtil
import org.jetbrains.kotlin.psi.KtStringTemplateExpression
import org.jetbrains.kotlin.psi.KtUnaryExpression
import org.jetbrains.kotlin.psi.KtValueArgument
import org.jetbrains.kotlin.psi.KtVisitorVoid
import org.jetbrains.kotlin.psi.KtWhileExpressionBase

/**
 * An id given to a builder function that is not the same on every render, or
 * not unique on the page: from the loop index, a random value, the clock or a
 * counter, or the same text in every row of a loop.
 *
 * A morph recognises an element by its id. An id from the index follows the
 * position, so when the server inserts a row, what the user typed lands in
 * the wrong one; a random id or a counter gives a new id on every render, and
 * the morph replaces the element along with focus and the text; a fixed id in
 * a loop gives every row the same id.
 *
 * Syntactic, so a weak warning: it reads what the argument is written as, and
 * does not follow a value through variables. An id from a key in the data,
 * `"case-${case.id}"`, is silent, also when the loop has an index next to it.
 */
class UnstableIdInspection : LocalInspectionTool() {
    override fun buildVisitor(holder: ProblemsHolder, isOnTheFly: Boolean): PsiElementVisitor =
        object : KtVisitorVoid() {
            override fun visitCallExpression(call: KtCallExpression) {
                val builder = call.builderName() ?: return
                val options = builders[builder]?.options ?: return
                // The members of `Lt` take the required options first.
                val order = options.sortedBy { !it.required }.map { it.name }
                for ((i, argument) in call.valueArguments.withIndex()) {
                    val name = argument.getArgumentName()?.asName?.asString() ?: order.getOrNull(i) ?: continue
                    if (name !in IDS) continue
                    val value = argument.getArgumentExpression() ?: continue
                    val why = unstable(value) ?: fixedInLoop(name, value, call) ?: continue
                    holder.registerProblem(value, "$name: $why. Make it from a key in the data, so it is unique on the page and the same on every render.", ProblemHighlightType.WEAK_WARNING)
                }
            }
        }

    /** Why the value changes between renders or follows the position, or `null`. */
    private fun unstable(value: KtExpression): String? {
        for (e in PsiTreeUtil.collectElements(value) { true }) {
            when (e) {
                is KtCallExpression -> {
                    val name = e.calledName() ?: continue
                    when {
                        name in RANDOM || name.startsWith("kotlin.random.Random") -> return "it is random, so it is new on every render"
                        name in CLOCK -> return "it comes from the clock, so it is new on every render"
                        name.startsWith("java.util.concurrent.atomic.Atomic") && name.substringAfterLast('.') in COUNTING -> return "it comes from a counter, so it is new on every render"
                    }
                }
                is KtUnaryExpression -> if (e.operationToken == KtTokens.PLUSPLUS || e.operationToken == KtTokens.MINUSMINUS) {
                    return "it comes from a counter, so it is new on every render"
                }
                is KtNameReferenceExpression -> {
                    // `parts[i].key` reads a key from the data by the index: that is stable.
                    if (isLookup(e)) continue
                    // Undocumented: in 2026.1 an implicit `it` resolves to the
                    // function literal of the lambda it belongs to, past the
                    // tags and `with` in between, and an explicit `{ it -> }`
                    // to its parameter (`UnstableIdInspectionTest`).
                    val target = e.target()
                    val index = if (target is KtFunctionLiteral) isIndexLambda(target.parent as? KtLambdaExpression) else isIndex(target)
                    if (index) return "it comes from the loop index, so it follows the position, not the row"
                }
            }
        }
        return null
    }

    /** Whether a name is the index in `xs[i]` or `xs.get(i)`, a lookup in the data rather than the id itself. */
    private fun isLookup(name: KtNameReferenceExpression): Boolean {
        val access = PsiTreeUtil.getParentOfType(name, KtArrayAccessExpression::class.java)
        if (access != null && access.indexExpressions.any { PsiTreeUtil.isAncestor(it, name, false) }) return true
        val argument = PsiTreeUtil.getParentOfType(name, KtValueArgument::class.java) ?: return false
        val call = PsiTreeUtil.getParentOfType(argument, KtCallExpression::class.java) ?: return false
        return call.calleeExpression?.text in setOf("get", "elementAt", "getOrNull")
    }

    /**
     * The function the call a lambda is passed to resolves to, when it is a
     * loop of the standard library: `forEach`, `map` and the like, `repeat`
     * and the `…Indexed` ones. Resolved, so an alias of `forEach` is a loop,
     * and an app's own `map`, or the `map` tag of kotlinx.html, is not.
     */
    private fun loopOf(lambda: KtLambdaExpression?): Pair<KtCallExpression, String>? {
        val call = PsiTreeUtil.getParentOfType(lambda ?: return null, KtCallExpression::class.java) ?: return null
        if (call.lambdaArguments.none { it.getLambdaExpression() == lambda } && call.valueArguments.none { it.getArgumentExpression() == lambda }) return null
        val name = call.calledName() ?: return null
        if (!name.startsWith("kotlin.")) return null
        val short = name.substringAfterLast('.')
        return if (short in LOOPS || short.endsWith("Indexed")) call to short else null
    }

    /** Whether the call a lambda is passed to runs it once per row. */
    private fun isLoop(lambda: KtLambdaExpression): Boolean = loopOf(lambda) != null

    /** Whether the first parameter of the lambda, or its `it`, is an index: `repeat`, `…Indexed`, or a loop over a range of numbers. */
    private fun isIndexLambda(lambda: KtLambdaExpression?): Boolean {
        val (call, name) = loopOf(lambda) ?: return false
        if (name.endsWith("Indexed") || name == "repeat") return true
        val receiver = (call.parent as? KtDotQualifiedExpression)?.takeIf { it.selectorExpression == call }?.receiverExpression
        return isNumberRange(KtPsiUtil.safeDeparenthesize(receiver ?: return false))
    }

    /** Whether a declaration is the index of a loop: of `forEachIndexed`, of `withIndex()`, or a loop over a range of numbers. */
    private fun isIndex(declaration: PsiElement?): Boolean {
        when (declaration) {
            is KtParameter -> {
                // `for (i in xs.indices)`, `for (i in 0 until n)`.
                val loop = declaration.parent as? KtForExpression
                if (loop != null && loop.loopParameter == declaration) return isNumberRange(loop.loopRange)
                // The first parameter of the lambda of `forEachIndexed { i, x -> }`,
                // `repeat(n) { i -> }` and `xs.indices.forEach { i -> }`.
                val literal = (declaration.parent?.parent as? KtFunctionLiteral) ?: return false
                if (literal.valueParameters.firstOrNull() != declaration) return false
                val lambda = literal.parent as? KtLambdaExpression ?: return false
                return isIndexLambda(lambda)
            }
            // `for ((i, x) in xs.withIndex())` and `xs.withIndex().forEach { (i, x) -> }`.
            is KtDestructuringDeclarationEntry -> {
                val destructuring = declaration.parent as? KtDestructuringDeclaration ?: return false
                if (destructuring.entries.firstOrNull() != declaration) return false
                val loop = PsiTreeUtil.getParentOfType(destructuring, KtForExpression::class.java)
                val source = if (loop != null && loop.destructuringDeclaration == destructuring) {
                    loop.loopRange
                } else {
                    val lambda = PsiTreeUtil.getParentOfType(destructuring, KtLambdaExpression::class.java) ?: return false
                    (PsiTreeUtil.getParentOfType(lambda, KtCallExpression::class.java)?.parent as? KtDotQualifiedExpression)?.receiverExpression
                }
                return source.isWithIndex()
            }
            else -> return false
        }
    }

    private fun KtExpression?.isWithIndex(): Boolean =
        ((this as? KtDotQualifiedExpression)?.selectorExpression as? KtCallExpression)?.calleeExpression?.text == "withIndex"

    private fun isNumberRange(range: KtExpression?): Boolean = when (range) {
        is KtDotQualifiedExpression -> range.selectorExpression?.text == "indices"
        is KtBinaryExpression -> range.operationReference.text in setOf("until", "..", "..<", "downTo")
        else -> false
    }

    /** Why a fixed id in a loop is a problem, or `null` when the value is not a fixed text or the call is not in a loop. */
    private fun fixedInLoop(name: String, value: KtExpression, call: KtCallExpression): String? {
        if (name == "keys") return null
        val text = value as? KtStringTemplateExpression ?: return null
        if (!text.entries.all { it is KtLiteralStringTemplateEntry }) return null
        var e: PsiElement? = call.parent
        while (e != null && e !is KtNamedFunction) {
            when {
                e is KtForExpression || e is KtWhileExpressionBase -> return "the same text in every row of the loop, so the rows share one id"
                e is KtLambdaExpression -> if (isLoop(e)) return "the same text in every row of the loop, so the rows share one id"
            }
            e = e.parent
        }
        return null
    }

    private companion object {
        val IDS = setOf("id", "titleId", "helpId", "errorId", "keys")
        val RANDOM = setOf("java.util.UUID.randomUUID", "kotlin.uuid.Uuid.Companion.random")
        val CLOCK = setOf("java.lang.System.nanoTime", "java.lang.System.currentTimeMillis")
        val COUNTING = setOf("incrementAndGet", "getAndIncrement", "decrementAndGet", "getAndDecrement", "addAndGet", "getAndAdd")
        val LOOPS = setOf("forEach", "map", "mapNotNull", "flatMap", "onEach", "repeat", "associate", "associateWith", "associateBy")
    }
}
