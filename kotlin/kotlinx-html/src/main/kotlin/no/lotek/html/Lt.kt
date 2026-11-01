package no.lotek.html

import kotlinx.html.Tag

/**
 * Puts the attributes from LO-TEK's builder functions on a tag in kotlinx.html.
 *
 * ```kotlin
 * val field = Lt.field(id = "fixer", required = RequiredMarker.TEXT, error = true, invalid = invalid)
 *
 * label { lt(field.label); +"Fixer's address" }
 * input { lt(Lt.input(type = InputType.EMAIL, state = field.state), field.control); name = "fixer" }
 * p { lt(Lt.errorText(), field.error); +"Enter a valid address." }
 * ```
 *
 * The sets are applied in order, and a later one wins over an earlier one,
 * like `{...a} {...b}` in JSX. `class` is the exception: the classes are
 * added to the ones the tag already has, so
 * `div(classes = "my-own") { lt(Lt.card()) }` gives both. A flag like
 * `hidden` has the empty text as its value, and kotlinx.html writes it as
 * `hidden=""`, which means the same in HTML.
 */
fun Tag.lt(vararg sets: Map<String, String>) {
    for (set in sets) {
        for ((name, value) in set) {
            attributes[name] = if (name == "class") joinClasses(attributes[name], value) else value
        }
    }
}

/** The classes in both, in order and without duplicates. */
private fun joinClasses(existing: String?, added: String): String =
    (existing.orEmpty().split(' ') + added.split(' '))
        .filter { it.isNotBlank() }
        .distinct()
        .joinToString(" ")
