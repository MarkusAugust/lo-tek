package no.lotek.intellij.kotlin

import com.intellij.psi.PsiElement
import com.intellij.psi.util.PsiTreeUtil
import no.lotek.Builder
import no.lotek.Lotek
import org.jetbrains.kotlin.psi.KtArrayAccessExpression
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtDotQualifiedExpression
import org.jetbrains.kotlin.psi.KtExpression
import org.jetbrains.kotlin.psi.KtFunctionType
import org.jetbrains.kotlin.psi.KtLambdaExpression
import org.jetbrains.kotlin.psi.KtNameReferenceExpression
import org.jetbrains.kotlin.psi.KtNamedDeclaration
import org.jetbrains.kotlin.psi.KtNamedFunction
import org.jetbrains.kotlin.psi.KtParenthesizedExpression
import org.jetbrains.kotlin.psi.KtProperty
import org.jetbrains.kotlin.psi.KtReferenceExpression

/*
 * What the inspections need to know about a builder function in Kotlin code:
 * which builder function a call is, which set an argument to `lt(…)` is, and
 * which tag the `lt(…)` stands in. Every answer is `null` when the code does
 * not say it for certain, and the inspections stay silent then.
 */

internal const val LT = "no.lotek.Lt."
internal const val LT_EXTENSION = "no.lotek.html.lt"

/** The builder functions in the manifest of the plugin, by name. */
internal val builders: Map<String, Builder> by lazy { Lotek.manifest.builders.associateBy { it.name } }

/**
 * The builder function a call calls, like `field` for `Lt.field(…)`, or
 * `null`, whatever the receiver is written as: `L.field` with an alias and
 * `field(…)` in `with(Lt)` are builder calls too.
 *
 * The inspections visit every call in every Kotlin file, so a call is only
 * resolved when its name is a builder function and it has no block: eleven
 * builder functions share their name with a tag of kotlinx.html, `input`,
 * `label`, `button` and others, and a tag is called with a block while a
 * builder function never is. Resolving every `input { }` on every pass costs
 * for nothing.
 */
internal fun KtCallExpression.builderName(): String? {
    val name = calleeExpression?.text ?: return null
    if (name !in builders || lambdaArguments.isNotEmpty()) return null
    return calledName()?.takeIf { it == "$LT$name" }?.let { name }
}

/** Whether the call is `lt(…)` from `lo-tek-kotlinx-html`. Resolved only when it is written `lt`. */
internal fun KtCallExpression.isLt(): Boolean = calleeExpression?.text == "lt" && calledName() == LT_EXTENSION

/**
 * The tag a call such as `lt(…)` stands in: `label` in `label { lt(…) }`,
 * `input` in `textInput { lt(…) }`, and `lt-field` in `ltField { … }`.
 *
 * It is the call the nearest lambda belongs to. For kotlinx.html the tag is
 * the receiver type of that lambda, `INPUT` for both `input` and
 * `textInput`, read from the declaration of the function; the function name
 * alone gave `textinput`. For `lo-tek-kotlinx-html` it is the name of the
 * function. In a lambda of anything else, `with`, `apply`, `repeat` or a
 * helper of the app, or with a receiver that is not one tag, such as
 * `FlowContent`, the answer is `null`. A `for` or an `if` has no lambda, so
 * `div { for (x in xs) lt(…) }` is in the `div`.
 */
internal fun KtCallExpression.enclosingTag(): String? {
    val lambda = PsiTreeUtil.getParentOfType(this, KtLambdaExpression::class.java, true, KtNamedFunction::class.java) ?: return null
    val owner = PsiTreeUtil.getParentOfType(lambda, KtCallExpression::class.java, true) ?: return null
    return owner.enclosingTagOfLambda(lambda)
}

/** The tag this call makes, when [lambda] is its block: `label` for `label { … }`, `null` for anything that is not a tag. */
internal fun KtCallExpression.enclosingTagOfLambda(lambda: KtLambdaExpression): String? {
    val owner = this
    if (owner.lambdaArguments.none { it.getLambdaExpression() == lambda }) return null
    val callee = owner.calleeExpression as? KtReferenceExpression ?: return null
    val function = callee.target() as? KtNamedFunction ?: return null
    val name = function.fqName?.asString() ?: return null
    return when {
        name.startsWith("kotlinx.html.") -> {
            val block = function.valueParameters.lastOrNull()?.typeReference?.typeElement as? KtFunctionType ?: return null
            val receiver = block.receiverTypeReference?.text?.substringBefore('<')?.substringAfterLast('.') ?: return null
            // `fun <T : Tag> T.visit(block: T.() -> Unit)` has a type parameter, not a tag.
            if (function.typeParameters.any { it.name == receiver }) return null
            // Undocumented: kotlinx.html 0.12.0 names a tag class after the tag
            // in capitals, INPUT, H2, TEXTAREA, in the generated gen-tags-*.kt
            // files; the interfaces it also has, FlowContent and HtmlBlockTag,
            // are not all capitals.
            receiver.takeIf { it.isNotEmpty() && it.all { c -> c.isUpperCase() || c.isDigit() } }?.lowercase()
        }
        name.startsWith("no.lotek.html.lt") && name.count { it == '.' } == 3 ->
            "lt" + name.substringAfterLast(".lt").replace(Regex("[A-Z]")) { "-" + it.value.lowercase() }
        else -> null
    }
}

/**
 * A set from a builder function with several sets: `field.control` is
 * `field`'s `control`. [receiver] is the name the set is read from, `field`,
 * so two fields in one function can be told apart; `null` when the set is not
 * read from a name. It is resolved only when it is needed, by [answer].
 */
internal data class SetOfBuilder(val builder: String, val field: String, val receiver: KtNameReferenceExpression?) {
    /** What the name the set is read from stands for, or `null`. */
    fun answer(): PsiElement? = receiver?.target()
}

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
    return SetOfBuilder(builder, match.groupValues[2], (e as KtDotQualifiedExpression).receiverExpression as? KtNameReferenceExpression)
}

/** The part a set fills, and the tags its selector allows, or `null` when the selector does not name a tag in every alternative. */
internal data class Placement(val element: String, val part: String, val tags: List<String>)

internal fun SetOfBuilder.placement(): Placement? {
    val target = builders[builder]?.parts?.get(field) ?: return null
    val selector = Lotek.manifest.elements[target.element]?.parts?.get(target.part)?.selector ?: return null
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
