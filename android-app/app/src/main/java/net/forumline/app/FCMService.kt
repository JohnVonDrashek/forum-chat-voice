package net.forumline.app

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Firebase Cloud Messaging service.
 * Android equivalent of iOS APNs + VoIP Push handling.
 */
class FCMService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Log.d(TAG, "FCM token: $token")
        PushManager.fcmToken = token
        PushManager.registerTokenWithServer()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data

        // Handle VoIP-style incoming call push (high-priority data message)
        if (data.containsKey("call_id")) {
            val callId = data["call_id"] ?: return
            val callerName = data["caller_name"] ?: "Incoming Call"
            val conversationId = data["conversation_id"]

            CallManager.reportIncomingCall(this, callId, callerName)

            val msg = mutableMapOf<String, Any?>(
                "type" to "voip-incoming",
                "callId" to callId,
                "callerName" to callerName,
            )
            if (conversationId != null) msg["conversationId"] = conversationId
            WebViewBridge.sendToWeb(msg)
            return
        }

        // Standard notification — let the system handle it if app is in background,
        // forward to web app if in foreground
        Log.d(TAG, "FCM message received: ${data.keys}")
    }

    companion object {
        private const val TAG = "Forumline"
    }
}
