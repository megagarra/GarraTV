package com.garratv.app

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/** Outgoing HTTP for the relay, the VOD proxy and the bridges. */
object Upstream {
    private const val USER_AGENT = "GarraTV/Android"
    private const val MAX_REDIRECTS = 8

    /**
     * Opens [url] following redirects by hand: HttpURLConnection refuses to follow
     * one that switches between http and https, which Xtream panels do all the
     * time when they hand a stream to their CDN. The returned connection's `url`
     * is the final address.
     */
    fun open(
        url: String,
        method: String = "GET",
        headers: Map<String, String> = emptyMap(),
        body: ByteArray? = null,
        readTimeoutMs: Int = 30_000,
    ): HttpURLConnection {
        var current = URL(url)
        var currentMethod = method
        var currentBody = body
        repeat(MAX_REDIRECTS + 1) {
            val connection = current.openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = readTimeoutMs
            connection.requestMethod = currentMethod
            connection.setRequestProperty("User-Agent", USER_AGENT)
            for ((name, value) in headers) connection.setRequestProperty(name, value)
            if (currentBody != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(currentBody) }
            }
            val status = connection.responseCode
            if (status in 300..399 && status != 304) {
                val location = connection.getHeaderField("Location")
                connection.disconnect()
                if (location.isNullOrEmpty()) throw IOException("Redirect without Location")
                current = URL(current, location)
                if (status == 303 || ((status == 301 || status == 302) && currentMethod == "POST")) {
                    currentMethod = "GET"
                    currentBody = null
                }
                return@repeat
            }
            return connection
        }
        throw IOException("Too many redirects")
    }
}

/** The Xtream account the web layer saved in config.json (the same file the server used). */
class Credentials(private val configFile: File) {
    data class Account(val hostUrl: String, val username: String, val password: String) {
        val base: String get() = hostUrl.trimEnd('/')
    }

    private var cachedAt = -1L
    private var cached: Account? = null

    @Synchronized
    fun current(): Account? {
        val modified = if (configFile.exists()) configFile.lastModified() else 0L
        if (modified != cachedAt) {
            cachedAt = modified
            cached = runCatching {
                val credentials = JSONObject(configFile.readText()).getJSONObject("credentials")
                Account(
                    credentials.getString("hostUrl"),
                    credentials.getString("username"),
                    credentials.getString("password"),
                ).takeIf { it.hostUrl.isNotEmpty() && it.username.isNotEmpty() }
            }.getOrNull()
        }
        return cached
    }
}
