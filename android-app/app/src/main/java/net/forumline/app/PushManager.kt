package net.forumline.app

import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Manages FCM token registration with the Forumline server.
 * Android equivalent of iOS PushManager.
 */
object PushManager {
    private const val TAG = "Forumline"
    private const val SERVER_URL = "https://app.forumline.net"

    var fcmToken: String? = null
    var accessToken: String? = null

    /** Fetch the current FCM token and register it if we have an access token */
    fun registerTokenWithServer() {
        val token = accessToken ?: return

        // If we already have the FCM token, register immediately
        fcmToken?.let {
            registerToken(it, token)
            return
        }

        // Otherwise fetch it first
        FirebaseMessaging.getInstance().token.addOnSuccessListener { fcm ->
            fcmToken = fcm
            Log.d(TAG, "FCM token: $fcm")
            registerToken(fcm, token)
        }
    }

    private fun registerToken(fcmToken: String, accessToken: String) {
        thread {
            try {
                val url = URL("$SERVER_URL/api/push?action=subscribe-fcm")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Authorization", "Bearer $accessToken")
                conn.doOutput = true

                val body = JSONObject().apply {
                    put("device_token", fcmToken)
                    put("token_type", "fcm")
                }

                OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }

                if (conn.responseCode == 200) {
                    Log.d(TAG, "Registered FCM token with server")
                } else {
                    Log.e(TAG, "Failed to register FCM token: ${conn.responseCode}")
                }
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to register FCM token", e)
            }
        }
    }
}
