package com.garratv.app

import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import org.json.JSONObject

private fun textResponse(status: Int, mime: String, text: String): WebResourceResponse =
    WebResourceResponse(mime, "utf-8", status, reasonFor(status), mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(text.toByteArray()))

internal fun errorResponse(status: Int, message: String): WebResourceResponse =
    textResponse(status, "application/json", "{\"error\":${Json.quote(message)}}")

internal fun reasonFor(status: Int): String = when (status) {
    200 -> "OK"
    206 -> "Partial Content"
    400 -> "Bad Request"
    404 -> "Not Found"
    416 -> "Range Not Satisfiable"
    502 -> "Bad Gateway"
    503 -> "Service Unavailable"
    else -> "Status $status"
}

/** WebResourceResponse rejects 3xx and anything outside 100..599. */
internal fun safeStatus(status: Int): Int = if (status in 100..599 && status !in 300..399) status else 502

/**
 * Where a URL last redirected to. Xtream panels answer every request with a slow
 * 302 to a tokenized CDN URL; going straight there while it is fresh skips the
 * panel for all but the first request.
 */
private class RedirectCache(private val ttlMs: Long, private val capacity: Int) {
    private val entries = object : LinkedHashMap<String, Pair<String, Long>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<String, Long>>?) = size > capacity
    }

    @Synchronized
    fun get(url: String): String? {
        val entry = entries[url] ?: return null
        if (System.currentTimeMillis() - entry.second > ttlMs) {
            entries.remove(url)
            return null
        }
        return entry.first
    }

    @Synchronized
    fun put(url: String, finalUrl: String) {
        if (finalUrl != url) entries[url] = finalUrl to System.currentTimeMillis()
    }

    @Synchronized
    fun forget(url: String) {
        entries.remove(url)
    }

    /** Opens [url], through its cached redirect when there is one; [usable] decides whether a cached hop worked. */
    fun open(url: String, headers: Map<String, String>, usable: (Int) -> Boolean): HttpURLConnection {
        get(url)?.let { known ->
            val direct = runCatching { Upstream.open(known, headers = headers) }.getOrNull()
            if (direct != null && usable(direct.responseCode)) return direct
            direct?.disconnect()
            forget(url)
        }
        val connection = Upstream.open(url, headers = headers)
        if (connection.responseCode in 200..299) put(url, connection.url.toString())
        return connection
    }
}

/**
 * Port of app/api/relay/route.ts for a single device: live playlists are fetched
 * natively (no CORS), rewritten so their segments also come back through here,
 * and segments are streamed straight from the provider to the player.
 */
class LiveRelay(private val credentials: Credentials, private val freeChannelsDir: File) {
    private val redirects = RedirectCache(ttlMs = 60_000, capacity = 500)

    /**
     * Free-tier ids (`br-1f959bb77595`) resolve against the country list the page's
     * backend already cached in data/free-channels/, so only listed channels play.
     */
    private fun freeChannelUrl(id: String): String? = runCatching {
        val country = id.substringBefore('-')
        if (!country.matches(Regex("^[a-z]{2}$"))) return null
        val channels = JSONObject(File(freeChannelsDir, "$country.json").readText()).getJSONArray("channels")
        (0 until channels.length()).map { channels.getJSONObject(it) }.firstOrNull { it.optString("id") == id }?.optString("url")
    }.getOrNull()?.takeIf { it.startsWith("http://") || it.startsWith("https://") }

    fun handle(uri: Uri): WebResourceResponse {
        val freeId = uri.getQueryParameter("free")
        val target = uri.getQueryParameter("src")
            ?: freeId?.let { freeChannelUrl(it) ?: return errorResponse(404, "Canal não encontrado") }
            ?: run {
            val streamId = uri.getQueryParameter("streamId")
            if (uri.getQueryParameter("type") != "live" || streamId.isNullOrEmpty()) {
                return errorResponse(400, "Parâmetros inválidos")
            }
            val account = credentials.current() ?: return errorResponse(503, "Conta não configurada")
            "${account.base}/live/${account.username}/${account.password}/$streamId.m3u8"
        }

        return try {
            val playlistHint = target.contains(".m3u8")
            val connection = if (playlistHint) {
                redirects.open(target, emptyMap()) { it in 200..299 }
            } else {
                Upstream.open(target)
            }
            val status = connection.responseCode
            if (status !in 200..299) {
                connection.disconnect()
                return errorResponse(502, "Falha no relay")
            }
            val finalUrl = connection.url.toString()
            val contentType = connection.contentType ?: ""
            if (finalUrl.contains(".m3u8") || contentType.contains("mpegurl", ignoreCase = true)) {
                val text = connection.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                textResponse(200, "application/vnd.apple.mpegurl", rewritePlaylist(text, finalUrl))
            } else {
                WebResourceResponse(
                    contentType.ifEmpty { "video/mp2t" }.substringBefore(';'),
                    null,
                    200,
                    "OK",
                    mapOf("Cache-Control" to "no-store"),
                    connection.inputStream,
                )
            }
        } catch (error: Exception) {
            errorResponse(502, "Falha no relay")
        }
    }

    private fun toRelay(reference: String, base: String): String = try {
        val absolute = URL(URL(base), reference).toString()
        "/api/relay?src=" + URLEncoder.encode(absolute, "UTF-8")
    } catch (error: Exception) {
        reference
    }

    private fun rewritePlaylist(text: String, base: String): String =
        text.split('\n').joinToString("\n") { line ->
            val trimmed = line.trim()
            when {
                trimmed.isEmpty() -> line
                trimmed.startsWith("#") -> URI_ATTRIBUTE.replace(line) { match ->
                    "URI=\"${toRelay(match.groupValues[1], base)}\""
                }
                else -> toRelay(trimmed, base)
            }
        }

    private companion object {
        val URI_ATTRIBUTE = Regex("URI=\"([^\"]+)\"")
    }
}

/**
 * Port of app/api/vod/[type]/[file]/route.ts: movies and episodes stream from the
 * provider with `Range` passed through, so seeking works and the password never
 * shows up in the page.
 */
class VodProxy(private val credentials: Credentials) {
    private val redirects = RedirectCache(ttlMs = 5 * 60_000, capacity = 200)

    fun handle(path: String, method: String, requestHeaders: Map<String, String>): WebResourceResponse {
        val match = VOD_PATH.matchEntire(path) ?: return errorResponse(400, "Parâmetros inválidos")
        val (type, id, ext) = match.destructured
        val account = credentials.current() ?: return errorResponse(503, "Conta não configurada")
        val upstreamUrl = "${account.base}/$type/${account.username}/${account.password}/$id.$ext"

        val headers = mutableMapOf<String, String>()
        requestHeaders.entries.firstOrNull { it.key.equals("Range", ignoreCase = true) }?.let { headers["Range"] = it.value }

        return try {
            val connection = redirects.open(upstreamUrl, headers) { it in 200..299 || it == 416 }
            val status = connection.responseCode
            if (status !in 200..299) {
                connection.disconnect()
                return errorResponse(if (status == 416) 416 else 502, "Vídeo indisponível")
            }
            val responseHeaders = mutableMapOf("Cache-Control" to "no-store", "Accept-Ranges" to "bytes")
            for (name in PASSTHROUGH) connection.getHeaderField(name)?.let { responseHeaders[name] = it }
            val mime = connection.contentType?.substringBefore(';')?.takeIf { it.startsWith("video/") || it.startsWith("audio/") }
                ?: mimeForExtension(ext)
            val body = if (method == "HEAD") {
                connection.disconnect()
                ByteArrayInputStream(ByteArray(0))
            } else {
                connection.inputStream
            }
            WebResourceResponse(mime, null, status, reasonFor(status), responseHeaders, body)
        } catch (error: Exception) {
            errorResponse(502, "Falha ao abrir o vídeo")
        }
    }

    private fun mimeForExtension(ext: String): String = when (ext.lowercase()) {
        "mp4", "m4v" -> "video/mp4"
        "mkv" -> "video/x-matroska"
        "webm" -> "video/webm"
        "avi" -> "video/x-msvideo"
        "ts" -> "video/mp2t"
        "mov" -> "video/quicktime"
        else -> "application/octet-stream"
    }

    private companion object {
        val VOD_PATH = Regex("^/api/vod/(movie|series)/(\\d+)\\.([A-Za-z0-9]{2,5})$")
        val PASSTHROUGH = listOf("Content-Length", "Content-Range", "Last-Modified", "ETag")
    }
}

/**
 * `/__net?u=<url>`: GETs the in-page backend makes to other origins (Xtream API,
 * TMDB, playlists) — a WebView would block them for lacking CORS headers.
 */
object NetProxy {
    private val DROPPED = setOf("host", "origin", "referer", "cookie", "accept-encoding", "user-agent", "if-none-match", "if-modified-since")

    fun handle(uri: Uri, method: String, requestHeaders: Map<String, String>): WebResourceResponse {
        val target = uri.getQueryParameter("u") ?: return errorResponse(400, "Missing url")
        if (!target.startsWith("http://") && !target.startsWith("https://")) return errorResponse(400, "Unsupported url")
        val headers = requestHeaders.filterKeys { it.lowercase() !in DROPPED }
        return try {
            val connection = Upstream.open(target, method = method, headers = headers, readTimeoutMs = 120_000)
            val status = safeStatus(connection.responseCode)
            val stream = if (connection.responseCode >= 400) connection.errorStream else connection.inputStream
            val responseHeaders = mutableMapOf("Cache-Control" to "no-store")
            connection.getHeaderField("Content-Range")?.let { responseHeaders["Content-Range"] = it }
            val contentType = connection.contentType ?: "application/octet-stream"
            WebResourceResponse(
                contentType.substringBefore(';').trim(),
                Regex("charset=([^;]+)", RegexOption.IGNORE_CASE).find(contentType)?.groupValues?.get(1)?.trim(),
                status,
                reasonFor(status),
                responseHeaders,
                if (method == "HEAD" || stream == null) ByteArrayInputStream(ByteArray(0)) else stream,
            )
        } catch (error: Exception) {
            errorResponse(502, error.message ?: "Network error")
        }
    }
}
