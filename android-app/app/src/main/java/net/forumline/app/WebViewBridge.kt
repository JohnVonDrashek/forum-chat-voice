package net.forumline.app

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * Native bridge between the Android WebView and the web app.
 * Android equivalent of iOS WebViewBridge + WebViewCoordinator.
 *
 * Web → Native: @JavascriptInterface methods called from JS
 * Native → Web: sendToWeb() evaluates JS in the WebView
 */
class WebViewBridge(private val activity: MainActivity) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun postMessage(message: String) {
        try {
            val json = JSONObject(message)
            val type = json.optString("type")

            when (type) {
                "call-state" -> handleCallState(json)
                "auth-state" -> handleAuthState(json)
                else -> Log.d(TAG, "Unknown bridge message: $type")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse bridge message", e)
        }
    }

    private fun handleCallState(json: JSONObject) {
        when (json.optString("state")) {
            "ringing-incoming" -> {
                val callId = json.optString("callId", "")
                val callerName = json.optString("callerName", "Unknown").take(100)
                CallManager.reportIncomingCall(activity, callId, callerName)
            }
            "active" -> {
                val callId = json.optString("callId", "")
                CallManager.reportCallConnected(callId)
            }
            "idle" -> {
                CallManager.reportCallEnded()
            }
        }
    }

    private fun handleAuthState(json: JSONObject) {
        val token = json.optString("accessToken", "").ifEmpty { null }
        PushManager.accessToken = token
        if (token != null) {
            PushManager.registerTokenWithServer()

            // Request notification permission after login (Android 13+)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                activity.requestPermissions(
                    arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                    1001
                )
            }
        }
    }

    companion object {
        private const val TAG = "Forumline"

        var webView: WebView? = null

        /** Send a message from native to the web app */
        fun sendToWeb(message: Map<String, Any?>) {
            val json = JSONObject(message).toString()
            val js = "window.forumlineNativeBridge?.onMessage($json);"
            Handler(Looper.getMainLooper()).post {
                webView?.evaluateJavascript(js, null)
            }
        }
    }
}
