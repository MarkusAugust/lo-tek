package no.lotek.intellij.kotlin

import com.intellij.psi.PsiElement
import com.intellij.psi.PsiMember
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtNamedDeclaration
import org.jetbrains.kotlin.psi.KtReferenceExpression

/*
 * What a name in Kotlin code stands for, through the references of the PSI
 * rather than the Analysis API. `resolve()` works in K2 mode as in K1, and
 * gives the declaration in the library, also from a compiled jar, while the
 * resolution calls of the Analysis API are marked experimental in 2026.1 and
 * change between versions.
 */

/** The declaration a reference expression points at, or `null` when it does not resolve. */
internal fun KtReferenceExpression.target(): PsiElement? =
    references.firstNotNullOfOrNull { it.resolve() }

/**
 * The fully qualified name of what a call calls, like `no.lotek.Lt.field`, or
 * `null`. A Java method, like `java.util.UUID.randomUUID`, is named by its
 * class. The Kotlin plugin always comes with the Java plugin, so the Java PSI
 * is there whenever this code runs.
 */
internal fun KtCallExpression.calledName(): String? {
    val callee = calleeExpression as? KtReferenceExpression ?: return null
    return when (val target = callee.target()) {
        is KtNamedDeclaration -> target.fqName?.asString()
        is PsiMember -> target.containingClass?.qualifiedName?.let { "$it.${target.name}" }
        else -> null
    }
}
