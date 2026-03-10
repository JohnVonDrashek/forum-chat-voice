package net.forumline.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.util.Log
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.WebViewFeature
import androidx.webkit.WebSettingsCompat

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout

    private val allowedHosts = setOf(
        "app.forumline.net",
        "demo.forumline.net",
        "forumline.net",
    )

    private val requestMicPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        pendingPermissionRequest?.let { request ->
            if (granted) {
                request.grant(request.resources)
            } else {
                request.deny()
            }
            pendingPermissionRequest = null
        }
    }

    private var pendingPermissionRequest: PermissionRequest? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Edge-to-edge display — web app handles safe areas via CSS env()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.parseColor("#0F172A")
        window.navigationBarColor = Color.parseColor("#0F172A")

        swipeRefresh = SwipeRefreshLayout(this).apply {
            setColorSchemeColors(Color.WHITE)
            setProgressBackgroundColorSchemeColor(Color.parseColor("#0F172A"))
        }

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0F172A"))
        }

        swipeRefresh.addView(webView)
        setContentView(swipeRefresh)

        swipeRefresh.setOnRefreshListener {
            webView.reload()
        }

        configureWebView()
        WebViewBridge.webView = webView

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        // To test locally: change to "http://10.0.2.2:3001" (emulator) or local IP
        webView.loadUrl("https://app.forumline.net")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        // Safe browsing can slow down page loads; forumline.net is trusted
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(webView.settings, false)
        }

        // Add the JS bridge (Android equivalent of WKScriptMessageHandler)
        webView.addJavascriptInterface(
            WebViewBridge(this),
            "forumlineAndroid"
        )

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                val host = url.host ?: return true

                // Allow navigation to forumline.net domains
                if (host in allowedHosts || host.endsWith(".forumline.net")) {
                    return false
                }

                // Open external links in the system browser
                Log.d(TAG, "Blocked navigation to disallowed host: $host")
                try {
                    val intent = android.content.Intent(
                        android.content.Intent.ACTION_VIEW, url
                    )
                    startActivity(intent)
                } catch (_: Exception) {}
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                swipeRefresh.isRefreshing = false
                // Inject bridge JS at page load (supplements the Android JS interface)
                view.evaluateJavascript(BRIDGE_JS, null)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // Handle WebRTC permission requests (microphone for voice calls)
            override fun onPermissionRequest(request: PermissionRequest) {
                val resources = request.resources
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in resources) {
                    if (ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED
                    ) {
                        request.grant(resources)
                    } else {
                        pendingPermissionRequest = request
                        requestMicPermission.launch(Manifest.permission.RECORD_AUDIO)
                    }
                } else {
                    request.grant(resources)
                }
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "[WebView] ${consoleMessage.message()}")
                }
                return true
            }
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    companion object {
        private const val TAG = "Forumline"

        /**
         * Bridge JS injected after page load. Sets up the same interface
         * the web app expects, routing through the Android JS interface.
         *
         * iOS uses: window.__FORUMLINE_IOS__ + window.forumlineNative.postMessage()
         * Android uses: window.__FORUMLINE_ANDROID__ + same postMessage() interface
         */
        private const val BRIDGE_JS = """
            (function() {
                if (window.__FORUMLINE_ANDROID__) return;
                window.__FORUMLINE_ANDROID__ = true;

                window.forumlineNative = {
                    postMessage: function(msg) {
                        window.forumlineAndroid.postMessage(
                            typeof msg === 'string' ? msg : JSON.stringify(msg)
                        );
                    }
                };

                window.forumlineNativeBridge = {
                    _handlers: [],
                    onMessage: function(msg) {
                        for (var i = 0; i < this._handlers.length; i++) {
                            try { this._handlers[i](msg); } catch(e) { console.error('[NativeBridge]', e); }
                        }
                    },
                    addHandler: function(fn) {
                        this._handlers.push(fn);
                    }
                };
            })();
        """
    }
}
