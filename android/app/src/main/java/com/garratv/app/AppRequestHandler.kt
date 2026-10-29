package com.garratv.app

import android.content.res.AssetManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream
import org.json.JSONArray

/**
 * Everything the page asks of its own origin: the exported Next.js bundle from the
 * APK assets, plus the streaming routes a WebView-side backend cannot serve.
 */
class AppRequestHandler(private val assets: AssetManager, credentials: Credentials, freeChannelsDir: File) {
    private val liveRelay = LiveRelay(credentials, freeChannelsDir)
    private val vodProxy = VodProxy(credentials)

    /** Dynamic page routes, e.g. ["dashboard","watch","movie","[streamId]"], exported once under `_`. */
    private val dynamicRoutes: List<List<String>> by lazy {
        runCatching {
            val json = assets.open("$ROOT/__dynamic-routes.json").use { it.readBytes().toString(Charsets.UTF_8) }
            val array = JSONArray(json)
            List(array.length()) { array.getString(it).split('/').filter(String::isNotEmpty) }
        }.getOrDefault(emptyList())
    }

    fun handle(request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url
        if (uri.host != HOST) return null
        val path = uri.path ?: "/"
        val method = request.method.uppercase()
        return when {
            path == "/__net" -> NetProxy.handle(uri, method, request.requestHeaders)
            path == "/api/relay" -> liveRelay.handle(uri)
            path.startsWith("/api/vod/") -> vodProxy.handle(path, method, request.requestHeaders)
            path.startsWith("/api/") -> errorResponse(404, "Not found")
            else -> staticFile(path)
        }
    }

    private fun staticFile(path: String): WebResourceResponse {
        val relative = path.trimStart('/')
        val candidates = mutableListOf<String>()
        fun addCandidates(base: String) {
            if (base.isEmpty() || base.endsWith("/")) {
                candidates += "${base}index.html"
            } else {
                candidates += base
                if (!base.substringAfterLast('/').contains('.')) candidates += "$base/index.html"
            }
        }
        addCandidates(relative)
        placeholderPath(relative)?.let(::addCandidates)

        for (candidate in candidates) {
            val stream = openAsset(candidate) ?: continue
            return WebResourceResponse(mimeFor(candidate), if (isText(candidate)) "utf-8" else null, 200, "OK", emptyMap(), stream)
        }
        val notFound = openAsset("404.html")
        return if (notFound != null) {
            WebResourceResponse("text/html", "utf-8", 404, "Not Found", emptyMap(), notFound)
        } else {
            errorResponse(404, "Not found")
        }
    }

    /** `dashboard/watch/movie/123/…` → `dashboard/watch/movie/_/…`, or null when no dynamic route matches. */
    private fun placeholderPath(relative: String): String? {
        val segments = relative.split('/').toMutableList()
        for (route in dynamicRoutes) {
            if (segments.size < route.size) continue
            var matches = true
            for (index in route.indices) {
                val part = route[index]
                if (!part.startsWith("[") && part != segments[index]) {
                    matches = false
                    break
                }
            }
            if (!matches) continue
            for (index in route.indices) if (route[index].startsWith("[")) segments[index] = "_"
            return segments.joinToString("/")
        }
        return null
    }

    private fun openAsset(relative: String): InputStream? = try {
        assets.open("$ROOT/$relative")
    } catch (missing: FileNotFoundException) {
        null
    } catch (error: Exception) {
        null
    }

    private fun isText(name: String): Boolean =
        name.substringAfterLast('.').lowercase() in setOf("html", "js", "css", "txt", "json", "svg", "map")

    private fun mimeFor(name: String): String = when (name.substringAfterLast('.').lowercase()) {
        "html" -> "text/html"
        "js" -> "application/javascript"
        "css" -> "text/css"
        "txt" -> "text/plain"
        "json", "map" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "ttf" -> "font/ttf"
        else -> "application/octet-stream"
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
        private const val ROOT = "web"
    }
}
