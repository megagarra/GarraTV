package com.garratv.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.UiModeManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.window.OnBackInvokedDispatcher
import java.io.File

/**
 * The whole app is the exported web UI in one WebView. There is no server: the
 * page runs the API handlers itself (android/web/), and this shell lends it the
 * native pieces a page cannot have — SQLite, files, and network without CORS.
 */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var lastRootBackAt = 0L

    /** `window.GarraTVApp`: its presence is how the page knows it runs inside the app. */
    class AppBridge {
        @JavascriptInterface
        fun platform(): String = "android"
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WebView.setWebContentsDebuggingEnabled(true)

        val storage = File(filesDir, "vfs")
        val dataDir = File(storage, "app/data")
        val handler = AppRequestHandler(assets, Credentials(File(dataDir, "config.json")), File(dataDir, "free-channels"))

        webView = WebView(this)
        webView.setBackgroundColor(0xFF000000.toInt())
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // Posters and channel logos come from http:// providers into an https page.
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
            // `GarraTVRemote` tells the page it is driven by a remote (app/lib/deviceProfile.ts).
            userAgentString = "$userAgentString GarraTVAndroid" + if (isTelevision()) " GarraTVRemote" else ""
        }
        webView.addJavascriptInterface(AppBridge(), "GarraTVApp")
        webView.addJavascriptInterface(DbBridge(dataDir), "GarraTVDb")
        webView.addJavascriptInterface(FsBridge(storage), "GarraTVFs")
        webView.addJavascriptInterface(HttpBridge(webView), "GarraTVHttp")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                handler.handle(request)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == AppRequestHandler.HOST) return false
                // Links out of the app (e.g. a TMDB page) open in the system browser, if any.
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            // The player's fullscreen button: hand the element's view to the window.
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                (window.decorView as ViewGroup).addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                webView.visibility = View.GONE
            }

            override fun onHideCustomView() {
                val view = customView ?: return
                (window.decorView as ViewGroup).removeView(view)
                customView = null
                webView.visibility = View.VISIBLE
                customViewCallback?.onCustomViewHidden()
                customViewCallback = null
            }
        }

        setContentView(webView)
        hideSystemBars()
        // Apps targeting Android 16 no longer get onBackPressed(): Back (the remote's
        // too) arrives through the back-invoked dispatcher, available from Android 13.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
        }
        if (savedInstanceState == null) webView.loadUrl("${AppRequestHandler.ORIGIN}/garratv/")
        else webView.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun isTelevision(): Boolean {
        val uiMode = getSystemService(UI_MODE_SERVICE) as? UiModeManager
        return uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
            packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
    }

    /**
     * The remote's Back never reaches the page as a key, so it is replayed as the
     * `GoBack` key the web UI already handles (closing the player, menus…). Only
     * when nothing took it does the shell go back in history — and on a top-level
     * screen, a second press within two seconds leaves the app.
     */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        handleBack()
    }

    private fun handleBack() {
        if (customView != null) {
            webView.webChromeClient?.onHideCustomView()
            return
        }
        webView.evaluateJavascript(BACK_SCRIPT) { result ->
            val path = Uri.parse(webView.url ?: "").path ?: ""
            when {
                path in ROOT_PATHS -> {
                    val now = System.currentTimeMillis()
                    if (now - lastRootBackAt < 2000) finish() else lastRootBackAt = now
                }
                result == "true" -> Unit
                webView.canGoBack() -> webView.goBack()
                else -> finish()
            }
        }
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        val ROOT_PATHS = setOf("/", "/garratv/", "/garratv/home/", "/garratv/free/")

        const val BACK_SCRIPT = """(function () {
            var target = document.activeElement || document.body;
            var event;
            try { event = new KeyboardEvent('keydown', { key: 'GoBack', bubbles: true, cancelable: true }); }
            catch (e) { return false; }
            target.dispatchEvent(event);
            return event.defaultPrevented;
        })()"""
    }
}
