package no.lotek.intellij.kotlin

import com.intellij.psi.PsiElement
import com.intellij.psi.util.PsiTreeUtil
import no.lotek.Lotek
import org.jetbrains.kotlin.psi.KtArrayAccessExpression
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtDotQualifiedExpression
import org.jetbrains.kotlin.psi.KtExpression
import org.jetbrains.kotlin.psi.KtLambdaExpression
import org.jetbrains.kotlin.psi.KtNameReferenceExpression
import org.jetbrains.kotlin.psi.KtNamedDeclaration
import org.jetbrains.kotlin.psi.KtNamedFunction
import org.jetbrains.kotlin.psi.KtParenthesizedExpression
import org.jetbrains.kotlin.psi.KtProperty

/*
 * What the inspections need to know about a builder function in Kotlin code:
 * which builder function a call is, which set an argument to `lt(…)` is, and
 * which tag the `lt(…)` stands in. Every answer is `null` when the code does
 * not say it for certain, and the inspections stay silent then.
 */

internal const val LT = "no.lotek.Lt."
internal const val LT_EXTENSION = "no.lotek.html.lt"

/** The builder function a call calls, like `field` for `Lt.field(…)`, or `null`. */
internal fun KtCallExpression.builderName(): String? =
    calledName()?.takeIf { it.startsWith(LT) }?.removePrefix(LT)?.takeIf { '.' !in it }

/** Whether the call is `lt(…)` from `lo-tek-kotlinx-html`. */
internal fun KtCallExpression.isLt(): Boolean = calledName() == LT_EXTENSION

/**
 * The tag a call such as `lt(…)` stands in: `label` in `label { lt(…) }`, and
 * `lt-field` in `ltField { … }`.
 *
 * It is the call the nearest lambda belongs to, and only when that call is a
 * tag from kotlinx.html or a web component from `lo-tek-kotlinx-html`. In a
 * lambda of anything else, `with`, `apply`, `repeat` or a helper of the app,
 * the receiver is unknown, and the answer is `null`. A `for` or an `if` has no
 * lambda, so `div { for (x in xs) lt(…) }` is in the `div`.
 */
internal fun KtCallExpression.enclosingTag(): String? {
    val lambda = PsiTreeUtil.getParentOfType(this, KtLambdaExpression::class.java, true, KtNamedFunction::class.java) ?: return null
    val owner = PsiTreeUtil.getParentOfType(lambda, KtCallExpression::class.java, true) ?: return null
    if (owner.lambdaArguments.none { it.getLambdaExpression() == lambda }) return null
    val name = owner.calledName() ?: return null
    return when {
        name.startsWith("kotlinx.html.") && name.count { it == '.' } == 2 -> name.substringAfterLast('.').lowercase()
        name.startsWith("no.lotek.html.lt") && name.count { it == '.' } == 3 ->
            "lt" + name.substringAfterLast(".lt").replace(Regex("[A-Z]")) { "-" + it.value.lowercase() }
        else -> null
    }
}

/** A set from a builder function with several sets: `field.control` is `field`'s `control`. */
internal data class SetOfBuilder(val builder: String, val field: String)

/**
 * Which set an argument to `lt(…)` is, read from the property it reads:
 * `control` in `FieldParts` is `field`'s `control`, whatever the variable is
 * called. `tabs.panels[i]` is `tabs`'s `panels`. Anything else is `null`.
 */
internal fun KtExpression.setOfBuilder(): SetOfBuilder? {
    var e: KtExpression = this
    while (true) {
        e = when (e) {
            is KtParenthesizedExpression -> e.expression ?: return null
            is KtArrayAccessExpression -> e.arrayExpression ?: return null
            else -> break
        }
    }
    val selector = (e as? KtDotQualifiedExpression)?.selectorExpression as? KtNameReferenceExpression ?: return null
    val fqName = (selector.target() as? KtNamedDeclaration)?.fqName?.asString() ?: return null
    val match = Regex("""^no\.lotek\.(\w+)Parts\.(\w+)$""").find(fqName) ?: return null
    val builder = match.groupValues[1].replaceFirstChar { it.lowercase() }
    return SetOfBuilder(builder, match.groupValues[2])
}

/** The part a set fills, and the tags its selector allows, or `null` when the selector does not name a tag in every alternative. */
internal data class Placement(val element: String, val part: String, val tags: List<String>)

internal fun SetOfBuilder.placement(): Placement? {
    val manifest = Lotek.manifest
    val target = manifest.builders.firstOrNull { it.name == builder }?.parts?.get(field) ?: return null
    val selector = manifest.elements[target.element]?.parts?.get(target.part)?.selector ?: return null
    val tags = tagsOf(selector) ?: return null
    return Placement(target.element, target.part, tags)
}

/**
 * The tag each alternative of a selector ends in: `input:not([type='hidden']),
 * textarea, select` gives input, textarea and select, and `:scope > dialog`
 * gives dialog. `null` when an alternative ends in a class or an attribute
 * alone, since the set itself may write what it matches.
 */
internal fun tagsOf(selector: String): List<String>? =
    splitTopLevel(selector).map { alternative ->
        val last = alternative.trim().split(Regex("""\s*>\s*|\s+""")).last()
        Regex("""^[a-z][a-z0-9-]*""").find(last)?.value ?: return null
    }.distinct()

/** The alternatives of a selector list, without splitting the commas inside `:not(…)`. */
private fun splitTopLevel(selector: String): List<String> {
    val out = mutableListOf<String>()
    var depth = 0
    var start = 0
    for ((i, c) in selector.withIndex()) {
        when (c) {
            '(', '[' -> depth++
            ')', ']' -> depth--
            ',' -> if (depth == 0) {
                out.add(selector.substring(start, i))
                start = i + 1
            }
        }
    }
    out.add(selector.substring(start))
    return out
}

/** The function an element stands in, where the inspections look for the other sets. */
internal fun PsiElement.enclosingFunction(): KtNamedFunction? = PsiTreeUtil.getParentOfType(this, KtNamedFunction::class.java)

/** The variable a builder function's answer is put in: `field` in `val field = Lt.field(…)`. */
internal fun KtCallExpression.assignedTo(): KtProperty? {
    var e: PsiElement = this
    while (e.parent is KtDotQualifiedExpression && (e.parent as KtDotQualifiedExpression).selectorExpression == e) e = e.parent
    return (e.parent as? KtProperty)?.takeIf { it.initializer == e }
}
