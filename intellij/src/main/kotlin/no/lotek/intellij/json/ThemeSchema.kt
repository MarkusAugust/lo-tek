package no.lotek.intellij.json

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.jetbrains.jsonSchema.extension.JsonSchemaFileProvider
import com.jetbrains.jsonSchema.extension.JsonSchemaProviderFactory
import com.jetbrains.jsonSchema.extension.SchemaType

/** The name a theme recipe has, as the documentation and `lotek theme` call it. */
private const val RECIPE = "lotek.theme.json"

/**
 * Holds a theme recipe to its schema.
 *
 * The schema is the one in the npm package, copied in by Gradle, so the IDE
 * knows the keys the core knows. Only a file with exactly the name of a
 * recipe gets it: any other JSON file is somebody else's.
 */
class ThemeSchemaProviderFactory : JsonSchemaProviderFactory {
    override fun getProviders(project: Project): List<JsonSchemaFileProvider> = listOf(ThemeSchemaProvider)
}

private object ThemeSchemaProvider : JsonSchemaFileProvider {
    override fun isAvailable(file: VirtualFile): Boolean = file.name == RECIPE

    override fun getName(): String = "LO-TEK theme recipe"

    override fun getSchemaFile(): VirtualFile? =
        JsonSchemaProviderFactory.getResourceFile(ThemeSchemaProviderFactory::class.java, "/schemas/theme.schema.json")

    override fun getSchemaType(): SchemaType = SchemaType.embeddedSchema
}
