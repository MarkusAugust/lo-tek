package no.lotek;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The builder functions as a Java developer calls them: static methods on
 * `Lt`, with the options left out from the back, without `INSTANCE`,
 * `Companion` or a `null` per option. The test is in Java, so a change that
 * makes a call longer from Java stops the build here rather than in an app.
 */
class JavaCallTest {
    @Test
    void aBuilderFunctionWithoutOptions() {
        assertEquals("class=\"lt-button\"", Lt.button().toHtml());
    }

    @Test
    void anOptionWithAValueFromTheList() {
        assertEquals(
            "class=\"lt-button\" data-variant=\"secondary\"",
            Lt.button(ButtonVariant.SECONDARY).toHtml());
    }

    @Test
    void aValueFromOutsideIsLookedUpWithoutCompanion() {
        assertEquals(ButtonVariant.GHOST, ButtonVariant.of("ghost"));
        assertNull(ButtonVariant.of("Ghost"));
    }

    @Test
    void aHandwrittenBuilderFunctionWithOnlyTheId() {
        FieldParts field = Lt.field("codename");
        assertEquals("class=\"lt-label\" for=\"codename\"", field.getLabel().toHtml());
        assertEquals("id=\"codename\"", field.getControl().toHtml());
        assertEquals(FieldState.DEFAULT, field.getState());
    }

    @Test
    void theRequiredIdComesFirstAlsoWhenTheManifestListsItLater() {
        // The manifest lists nine options before `id` in `lt.suggestion`.
        SuggestionParts search = Lt.suggestion("breaker");
        assertEquals("breaker-list", search.getList().get("id"));
    }

    @Test
    void anEmptyIdThrowsAsInKotlin() {
        assertThrows(IllegalArgumentException.class, () -> Lt.field(""));
    }

    @Test
    void theRequiredOptionsOfTabs() {
        TabsParts tabs = Lt.tabs("claim", List.of("summary", "files"), "Parts of the claim");
        assertEquals("href=\"#claim-files\"", tabs.getTabs().get(1).toHtml());
    }

    @Test
    void theClassOfAPartIsAField() {
        assertEquals("class=\"lt-card__title\"", Lt.card.title.toHtml());
    }
}
