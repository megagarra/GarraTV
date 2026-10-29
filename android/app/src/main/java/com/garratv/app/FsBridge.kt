package com.garratv.app

import android.webkit.JavascriptInterface
import java.io.File

/**
 * `window.GarraTVFs`: the web layer's `fs` (android/web/shims/fs.ts). Virtual
 * absolute paths (`/app/data/config.json`) are rooted in the app's private
 * storage; `..` is refused, so nothing outside it can be reached.
 */
class FsBridge(private val root: File) {
    private fun resolve(path: String): File {
        val parts = path.split('/', '\\').filter { it.isNotEmpty() && it != "." }
        require(parts.none { it == ".." }) { "Path escapes the app storage" }
        return File(root, parts.joinToString(File.separator))
    }

    private inline fun guard(block: () -> String): String = try {
        block()
    } catch (error: Throwable) {
        Json.error(error.message, "EIO")
    }

    private fun missing(path: String) = Json.error("ENOENT: no such file or directory, '$path'", "ENOENT")

    @JavascriptInterface
    fun readFile(path: String): String = guard {
        val file = resolve(path)
        when {
            !file.exists() -> missing(path)
            file.isDirectory -> Json.error("EISDIR: illegal operation on a directory, '$path'", "EISDIR")
            else -> Json.okString(file.readText())
        }
    }

    @JavascriptInterface
    fun writeFile(path: String, data: String): String = guard {
        val file = resolve(path)
        file.parentFile?.mkdirs()
        // Write-then-rename: a crash mid-write never leaves config.json half written.
        val temp = File(file.parentFile, ".${file.name}.tmp")
        temp.writeText(data)
        if (!temp.renameTo(file)) {
            file.writeText(data)
            temp.delete()
        }
        Json.ok("null")
    }

    @JavascriptInterface
    fun mkdir(path: String): String = guard {
        resolve(path).mkdirs()
        Json.ok("null")
    }

    @JavascriptInterface
    fun readdir(path: String): String = guard {
        val dir = resolve(path)
        if (!dir.isDirectory) return@guard missing(path)
        val out = StringBuilder("[")
        dir.listFiles().orEmpty().filterNot { it.name.endsWith(".tmp") }.forEachIndexed { index, entry ->
            if (index > 0) out.append(',')
            out.append("{\"name\":")
            Json.quote(entry.name, out)
            out.append(",\"directory\":").append(entry.isDirectory).append('}')
        }
        Json.ok(out.append(']').toString())
    }

    @JavascriptInterface
    fun unlink(path: String): String = guard {
        val file = resolve(path)
        if (!file.exists()) return@guard missing(path)
        file.delete()
        Json.ok("null")
    }

    @JavascriptInterface
    fun stat(path: String): String = guard {
        val file = resolve(path)
        if (!file.exists()) return@guard missing(path)
        Json.ok("{\"size\":${file.length()},\"directory\":${file.isDirectory},\"mtimeMs\":${file.lastModified()}}")
    }
}
