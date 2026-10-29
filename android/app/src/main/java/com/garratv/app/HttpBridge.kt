package com.garratv.app

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * `window.GarraTVHttp`: the few non-GET requests the web layer makes to other
 * origins (OpenSubtitles login/download). Answers asynchronously through
 * `window.__garratvHttpDone(id, reply)`. GETs take the streaming `/__net` route.
 */
class HttpBridge(private val webView: WebView) {
    private val executor = Executors.newFixedThreadPool(4)
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun request(id: String, method: String, url: String, headersJson: String, body: String) {
        executor.execute {
            val reply = try {
                val headers = JSONObject(headersJson).let { json -> json.keys().asSequence().associateWith { json.getString(it) } }
                val connection = Upstream.open(url, method, headers, body.takeIf { it.isNotEmpty() }?.toByteArray())
                val status = safeStatus(connection.responseCode)
                val stream = if (connection.responseCode >= 400) connection.errorStream else connection.inputStream
                val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
                val out = StringBuilder("{\"status\":").append(status).append(",\"headers\":{\"content-type\":")
                Json.quote(connection.contentType ?: "application/octet-stream", out)
                out.append("},\"body\":")
                Json.quote(text, out)
                out.append('}').toString()
            } catch (error: Exception) {
                "{\"status\":0,\"headers\":{},\"body\":\"\",\"error\":${Json.quote(error.message ?: "Network error")}}"
            }
            main.post {
                webView.evaluateJavascript("window.__garratvHttpDone && window.__garratvHttpDone(${Json.quote(id)}, $reply)", null)
            }
        }
    }
}
