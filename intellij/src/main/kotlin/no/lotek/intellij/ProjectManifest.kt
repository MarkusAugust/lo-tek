package no.lotek.intellij

import com.intellij.lang.injection.InjectedLanguageManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.roots.ProjectFileIndex
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiFile
import java.util.concurrent.ConcurrentHashMap

/**
 * The manifest the project is checked against, and completion reads the
 * classes from, found the way the language server finds it (`vocabulary()`
 * in `cli/src/lsp.rs`).
 *
 * From the directory the file is in and upwards, up to and including the
 * project directory, or the content root the file belongs to when it is
 * outside the project directory: first `build/lotek/manifest.json`, which
 * the Gradle task `lotekManifest` writes when the project has taken over
 * components, then the manifest in `node_modules/@lo-tek/interfaces`. Not
 * above it: a package in the home directory is not the project's. A file
 * under none of them, like a scratch file, is checked against the manifest
 * at the project directory, and then the one at each content root.
 * If none of them exists, the manifest in the Kotlin package applies.
 *
 * The cases in `cli/manifest-lookup.json` are built by both the plugin and
 * the language server, and the two must give the same answer. They differ
 * in four things the table does not hold. The server has an option for a
 * specific manifest, and the plugin has none. When no manifest is found,
 * the server uses the package its host points to, or checks nothing. A
 * manifest that cannot be read makes the server check nothing and tell the
 * user, where the plugin goes to the Kotlin package and writes to the log.
 * And with several workspaces the server tries the root of each of them for
 * every file, where the plugin does so only for a file under no root.
 *
 * For an injected fragment the search starts from the file the string is in.
 */
internal object ProjectManifest {
    val CANDIDATES =
        listOf(
            "build/lotek/manifest.json",
            "node_modules/@lo-tek/interfaces/manifest/manifest.json",
        )

    private val log = Logger.getInstance(ProjectManifest::class.java)

    /** The text of a manifest, and which version of the file it was read from. */
    private class Read(val stamp: Long, val text: String)

    private val read = ConcurrentHashMap<String, Read>()

    /** The manifests the core could not read, so it is reported once. */
    private val rejected = ConcurrentHashMap.newKeySet<String>()

    /** The text of the manifest for [file], or `null` for the manifest in the Kotlin package. */
    fun forFile(file: PsiFile): String? = readFor(file)?.text

    private fun readFor(file: PsiFile): Read? {
        val project = file.project
        val host = InjectedLanguageManager.getInstance(project).getTopLevelFile(file) ?: file
        val virtualFile = host.originalFile.virtualFile ?: return null
        // The project directory corresponds to the workspace the language
        // server gets. A module has its own content root, and if the search
        // stopped there, a `node_modules` at the root of a monorepo would
        // never be found.
        val projectDir = project.guessProjectDir()
        val root =
            if (projectDir != null && VfsUtilCore.isAncestor(projectDir, virtualFile, false)) {
                projectDir
            } else {
                ProjectFileIndex.getInstance(project).getContentRootForFile(virtualFile, false)
            }
        // A file under no root, like a scratch file, has nothing to stop at,
        // so nothing is searched upwards from it.
        var dir: VirtualFile? = if (root == null) null else virtualFile.parent
        while (dir != null) {
            manifestIn(dir)?.let { return load(it) }
            if (dir == root) break
            dir = dir.parent
        }
        if (root != null) return null
        // A file under no root gets the project directory and then every
        // content root, as the language server tries the root of every
        // workspace. A scratch file is then checked against the classes the
        // rest of the project has. Not a file under a root: a module is a
        // content root too, and a page in one module would otherwise get the
        // manifest of the module beside it.
        for (top in listOfNotNull(projectDir) + ProjectRootManager.getInstance(project).contentRoots) {
            manifestIn(top)?.let { return load(it) }
        }
        return null
    }

    /** The first candidate that is a file in [dir]. A directory with the name is passed over. */
    private fun manifestIn(dir: VirtualFile): VirtualFile? =
        CANDIDATES.firstNotNullOfOrNull { candidate -> dir.findFileByRelativePath(candidate)?.takeUnless { it.isDirectory } }

    private fun load(file: VirtualFile): Read? {
        val stamp = file.modificationStamp
        read[file.url]?.let { if (it.stamp == stamp) return it }
        val text =
            try {
                VfsUtilCore.loadText(file)
            } catch (unreadable: java.io.IOException) {
                log.warn("LO-TEK could not read ${file.presentableUrl}, and checks against the manifest in the Kotlin package.", unreadable)
                return null
            }
        val fresh = Read(stamp, text)
        read[file.url] = fresh
        rejected.remove(file.url)
        return fresh
    }

    /** That the core rejected the manifest: one warning in the log per version of the file. */
    fun rejectedBy(text: String, reason: String) {
        val url = read.entries.firstOrNull { it.value.text === text }?.key ?: return
        if (rejected.add(url)) {
            log.warn("LO-TEK could not use $url, and checks against the manifest in the Kotlin package: $reason")
        }
    }
}
