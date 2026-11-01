package no.lotek

/*
 * The builder functions whose options interact, so they cannot be written as
 * a table in the manifest. The rest are generated from the manifest
 * (`Lt.kt`). All are tested against the results from TypeScript in
 * `ContractTest`, so they cannot drift apart.
 */

/** The id must be given. TypeScript makes a random one, but that gives different markup on every run. */
private fun requireId(builder: String, id: String): String {
    require(id.isNotBlank()) { "Lt.$builder: id cannot be empty. Use the field's name or another fixed id." }
    return id
}

/**
 * The keys a builder function makes ids from, checked as in TypeScript: an
 * empty key, one with whitespace as JavaScript counts it, or two equal keys
 * throw.
 */
private fun requireKeys(builder: String, keys: List<String>): List<String> {
    val seen = HashSet<String>()
    for (key in keys) {
        require(key.isNotEmpty()) {
            "Lt.$builder: a key in keys is empty. The keys become ids, and each must be a fixed value from the data."
        }
        require(key.none(::isJsWhitespace)) {
            "Lt.$builder: the key \"$key\" contains whitespace. The keys become ids, and an id cannot contain whitespace."
        }
        require(seen.add(key)) {
            "Lt.$builder: the key \"$key\" appears twice in keys. The keys become ids, and two equal ids point to the same element."
        }
    }
    return keys
}

/** The label for `lt.label` and `lt.legend`: `optional` applies only without `required`. */
private fun marked(
    className: String,
    required: RequiredMarker?,
    optional: Boolean?,
    disabled: Boolean?,
): LinkedHashMap<String, String> {
    val a = linkedMapOf("class" to className)
    if (required != null) a["data-required"] = required.value
    if (optional == true && required == null) a["data-optional"] = ""
    if (disabled == true) a["aria-disabled"] = "true"
    return a
}

/** `lt.label`: a label. The marker is only visual, so set `required` on the field too. */
fun Lt.label(
    required: RequiredMarker? = null,
    optional: Boolean? = null,
    disabled: Boolean? = null,
): Attributes = Attributes(marked("lt-label", required, optional, disabled))

/** `lt.legend`: the label for a group, with the same marker as [label]. */
fun Lt.legend(
    required: RequiredMarker? = null,
    optional: Boolean? = null,
    disabled: Boolean? = null,
): Attributes = Attributes(marked("lt-legend", required, optional, disabled))

/**
 * `lt.errorSummary`: the error summary. The box is hidden when [count] is zero,
 * and takes its name from the heading with [titleId], by default [id] with
 * `-title`. An empty one counts as none; one with whitespace throws.
 */
fun Lt.errorSummary(
    count: Number? = null,
    id: String? = null,
    titleId: String? = null,
): ErrorSummaryParts {
    val titleId = titleId?.takeUnless { it.all(::isJsWhitespace) }
        ?: id?.takeUnless { it.all(::isJsWhitespace) }?.let { "$it-title" }
    if (titleId != null) {
        require(titleId.none(::isJsWhitespace)) {
            "Lt.errorSummary: the titleId \"$titleId\" contains whitespace. aria-labelledby splits on whitespace, so the box would point at ids that are not the heading's."
        }
    }
    val host = linkedMapOf("class" to "lt-error-summary", "role" to "alert", "tabindex" to "-1")
    if (id != null) host["id"] = id
    if ((count?.toDouble() ?: 0.0) == 0.0) host["hidden"] = ""
    if (titleId != null) host["aria-labelledby"] = titleId
    val title = linkedMapOf("class" to "lt-error-summary__title")
    if (titleId != null) title["id"] = titleId
    return ErrorSummaryParts(host = Attributes(host), title = Attributes(title))
}

/** The ids in `aria-describedby`, split on whitespace as JavaScript splits them, without empty ones and duplicates. */
private fun joinDescribedBy(ids: List<String?>): String? {
    val unique = LinkedHashSet<String>()
    for (id in ids) {
        if (id.isNullOrEmpty()) continue
        for (part in splitJsWhitespace(id)) if (part.isNotEmpty()) unique.add(part)
    }
    return if (unique.isEmpty()) null else unique.joinToString(" ")
}

/** The same as `text.split(/\s+/)` in JavaScript, with JavaScript's definition of whitespace. */
private fun splitJsWhitespace(text: String): List<String> {
    val out = ArrayList<String>()
    val current = StringBuilder()
    var inSpace = false
    for (c in text) {
        if (isJsWhitespace(c)) {
            if (!inSpace) out.add(current.toString().also { current.setLength(0) })
            inSpace = true
        } else {
            inSpace = false
            current.append(c)
        }
    }
    out.add(current.toString())
    return out
}

private fun isJsWhitespace(c: Char): Boolean =
    c == '\t' || c == '\n' || c == '\u000B' || c == '\u000C' || c == '\r' || c == ' ' ||
        c == ' ' || c == ' ' || c in ' '..' ' || c == ' ' ||
        c == ' ' || c == ' ' || c == ' ' || c == '　' || c == '﻿'

/**
 * `lt.field`: wires the label, control, help text and error text.
 *
 * ```kotlin
 * val field = Lt.field(id = "fixer", required = RequiredMarker.TEXT, help = true, error = true, invalid = invalid)
 * "<label ${field.label.toHtml()}>Fixer's address</label>"
 * "<input ${(Lt.input(type = InputType.EMAIL, state = field.state) + field.control).toHtml()}>"
 * ```
 */
fun Lt.field(
    id: String,
    help: Boolean? = null,
    error: Boolean? = null,
    helpId: String? = null,
    errorId: String? = null,
    required: RequiredMarker? = null,
    optional: Boolean? = null,
    invalid: Boolean? = null,
    disabled: Boolean? = null,
    describedBy: List<String>? = null,
): FieldParts = computeField("field", id, help, error, helpId, errorId, required, optional, invalid, disabled, describedBy)

private fun computeField(
    builder: String,
    givenId: String,
    help: Boolean?,
    error: Boolean?,
    givenHelpId: String?,
    givenErrorId: String?,
    required: RequiredMarker?,
    optional: Boolean?,
    invalid: Boolean?,
    disabled: Boolean?,
    describedBy: List<String>?,
): FieldParts {
    val id = requireId(builder, givenId)
    val helpId = givenHelpId ?: "$id-help"
    val errorId = givenErrorId ?: "$id-error"
    val isInvalid = invalid == true

    val label = linkedMapOf("class" to "lt-label", "for" to id)
    if (required != null) label["data-required"] = required.value
    if (optional == true && required == null) label["data-optional"] = ""
    if (disabled == true) label["aria-disabled"] = "true"

    val control = linkedMapOf("id" to id)
    joinDescribedBy(
        listOf(
            if (help == true) helpId else null,
            if (isInvalid && error == true) errorId else null,
        ) + describedBy.orEmpty(),
    )?.let { control["aria-describedby"] = it }
    if (isInvalid) {
        control["aria-invalid"] = "true"
        control["data-state"] = "invalid"
    }
    if (disabled == true) control["disabled"] = ""

    val errorAttributes = linkedMapOf("id" to errorId)
    if (!isInvalid) errorAttributes["hidden"] = ""

    return FieldParts(
        label = Attributes(label),
        control = Attributes(control),
        help = Attributes(mapOf("id" to helpId)),
        error = Attributes(errorAttributes),
        state = if (isInvalid) FieldState.INVALID else FieldState.DEFAULT,
    )
}

/** `lt.suggestion`: a field with a suggestion list. `<lt-suggestion>` handles the keyboard and the filtering. */
fun Lt.suggestion(
    invalid: Boolean? = null,
    error: Boolean? = null,
    disabled: Boolean? = null,
    required: RequiredMarker? = null,
    optional: Boolean? = null,
    help: Boolean? = null,
    helpId: String? = null,
    errorId: String? = null,
    describedBy: List<String>? = null,
    id: String,
    keys: List<String>? = null,
    activeIndex: Number? = null,
    open: Boolean? = null,
    pending: Boolean? = null,
): SuggestionParts {
    val field = computeField("suggestion", id, help, error, helpId, errorId, required, optional, invalid, disabled, describedBy)
    val optionKeys = requireKeys("suggestion", keys ?: emptyList())
    val n = optionKeys.size.toDouble()
    val active = activeIndex?.toDouble() ?: -1.0
    val isOpen = open == true
    val listId = "$id-list"
    val labelId = "$id-label"
    val statusId = "$id-status"
    fun optionId(index: Int) = "$id-option-${optionKeys[index]}"
    // The active option is written only when the list is open, and only for an integer, as in TypeScript.
    val marked = isOpen && active % 1.0 == 0.0 && active >= 0 && active < n

    val control = LinkedHashMap(field.control)
    control["class"] = "lt-input"
    control["type"] = "text"
    control["role"] = "combobox"
    control["autocomplete"] = "off"
    control["aria-expanded"] = if (isOpen) "true" else "false"
    control["aria-controls"] = listId
    control["aria-describedby"] = listOfNotNull(field.control["aria-describedby"], statusId).joinToString(" ")
    control["aria-autocomplete"] = "list"
    if (marked) control["aria-activedescendant"] = optionId(active.toInt())

    val list = linkedMapOf(
        "class" to "lt-suggestion__list",
        "id" to listId,
        "role" to "listbox",
        "aria-labelledby" to labelId,
        "popover" to "manual",
    )
    if (!isOpen) list["hidden"] = ""
    if (pending == true) list["aria-busy"] = "true"

    val empty = linkedMapOf("class" to "lt-suggestion__empty")
    if (!(n == 0.0 && pending != true)) empty["hidden"] = ""

    return SuggestionParts(
        // The label also gives the list its name, through `aria-labelledby`.
        label = field.label + mapOf("id" to labelId),
        control = Attributes(control),
        list = Attributes(list),
        options = optionKeys.indices.map { index ->
            Attributes(
                mapOf(
                    "class" to "lt-suggestion__option",
                    "id" to optionId(index),
                    "role" to "option",
                    "aria-selected" to if (marked && index.toDouble() == active) "true" else "false",
                ),
            )
        },
        empty = Attributes(empty),
        status = Attributes(
            mapOf(
                "class" to "lt-sr-only",
                "id" to statusId,
                "role" to "status",
            ),
        ),
        value = Attributes(mapOf("class" to "lt-suggestion__value", "type" to "hidden")),
        help = field.help,
        error = field.error,
        state = field.state,
    )
}

/**
 * `lt.tabs`: a tab list where the tabs are links to the panels. Only links,
 * ids and classes: without JavaScript the list is a table of contents, and
 * the panels follow one another. `<lt-tabs>` writes the roles, the selection
 * and `hidden`. The panels get ids from [keys], and [label] is the name of
 * the list; an empty one throws. The first tab is selected; another comes
 * from the address, like `#case-attachments`.
 */
fun Lt.tabs(
    id: String,
    keys: List<String>,
    label: String,
): TabsParts {
    requireId("tabs", id)
    require(id.none(::isJsWhitespace)) {
        "Lt.tabs: the id \"$id\" contains whitespace. It becomes part of every id, and an id cannot contain whitespace."
    }
    // Whitespace as JavaScript counts it, like `trim()` in TypeScript.
    require(!label.all(::isJsWhitespace)) {
        "Lt.tabs: label is missing or empty. The tab list needs a name that says what the tabs choose between, otherwise the screen reader says only \"tab list\"."
    }
    val tabKeys = requireKeys("tabs", keys)
    fun panelId(key: String) = "$id-$key"

    return TabsParts(
        list = Attributes(mapOf("class" to "lt-tabs__list", "aria-label" to label)),
        tabs = tabKeys.map { key -> Attributes(mapOf("href" to "#${panelId(key)}")) },
        panels = tabKeys.map { key ->
            Attributes(mapOf("id" to panelId(key), "class" to "lt-tabs__panel"))
        },
        headings = tabKeys.map { key -> Attributes(mapOf("id" to "$id-$key-heading")) },
    )
}
