package no.lotek.intellij.kotlin

import com.intellij.psi.PsiElement
import com.intellij.psi.PsiMember
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtNamedDeclaration
import org.jetbrains.kotlin.psi.KtReferenceExpression

/*
 * What a name in Kotlin code stands for, through the references of the PSI
 * rather than the Analysis API. `resolve()` works in K2 mode as in K1, and
 * gives the declaration in the library, also from a compiled jar
 * (`ResolveTest`). Undocumented: in 2026.1 `KaResolver.resolveSymbol` is
 * `@KaExperimentalApi`, read from the annotation on the method in
 * kotlin-plugin.jar, and the compiler refuses it without an opt-in.
 */

/** The declaration a reference expression points at, or `null` when it does not resolve. */
internal fun KtReferenceExpression.target(): PsiElement? =
    references.firstNotNullOfOrNull { it.resolve() }

/**
 * The fully qualified name of what a call calls, like `no.lotek.Lt.field`, or
 * `null`. A Java method, like `java.util.UUID.randomUUID`, is named by its
 * class. The Java PSI is there whenever this code runs. Undocumented: in 2026.1
 * the Kotlin plugin depends on the module `intellij.java.backend`, in
 * META-INF/plugin.xml in kotlin-plugin.jar, so it is never loaded without it.
 */
internal fun KtCallExpression.calledName(): String? {
    val callee = calleeExpression as? KtReferenceExpression ?: return null
    return when (val target = callee.target()) {
        is KtNamedDeclaration -> target.fqName?.asString()
        is PsiMember -> target.containingClass?.qualifiedName?.let { "$it.${target.name}" }
        else -> null
    }
}
