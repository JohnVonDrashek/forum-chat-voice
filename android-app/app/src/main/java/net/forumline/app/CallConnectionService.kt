package net.forumline.app

import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccountHandle
import android.util.Log

/**
 * Android Telecom ConnectionService — handles the native call UI.
 * Android equivalent of iOS CXProviderDelegate.
 */
class CallConnectionService : ConnectionService() {

    override fun onCreateIncomingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest
    ): Connection {
        val extras = request.extras
        val callId = extras.getString("call_id") ?: ""
        val callerName = extras.getString("caller_name") ?: "Incoming Call"

        val connection = CallConnection(this, callId).apply {
            setCallerDisplayName(callerName, android.telecom.TelecomManager.PRESENTATION_ALLOWED)
            setAddress(
                android.net.Uri.fromParts("tel", callerName, null),
                android.telecom.TelecomManager.PRESENTATION_ALLOWED
            )
            connectionCapabilities = Connection.CAPABILITY_MUTE or Connection.CAPABILITY_SUPPORT_HOLD
            setRinging()
        }

        CallManager.activeConnection = connection
        return connection
    }

    override fun onCreateIncomingConnectionFailed(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?
    ) {
        Log.e("Forumline", "Failed to create incoming connection")
        CallManager.activeCallId = null
    }
}

/**
 * Represents a single call connection.
 * Handles answer/reject/mute actions and forwards them to the web app.
 */
class CallConnection(
    private val context: ConnectionService,
    private val callId: String,
) : Connection() {
    private var audioFocusRequest: AudioFocusRequest? = null

    override fun onAnswer() {
        setActive()
        requestAudioFocus()

        WebViewBridge.sendToWeb(mapOf(
            "type" to "callkit-answer",
            "callId" to callId,
        ))
    }

    override fun onReject() {
        setDisconnected(DisconnectCause(DisconnectCause.REJECTED))
        destroy()
        releaseAudioFocus()

        WebViewBridge.sendToWeb(mapOf(
            "type" to "callkit-end",
            "callId" to callId,
        ))

        CallManager.activeConnection = null
        CallManager.activeCallId = null
    }

    override fun onDisconnect() {
        setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
        destroy()
        releaseAudioFocus()

        WebViewBridge.sendToWeb(mapOf(
            "type" to "callkit-end",
            "callId" to callId,
        ))

        CallManager.activeConnection = null
        CallManager.activeCallId = null
    }

    override fun onCallAudioStateChanged(state: android.telecom.CallAudioState) {
        WebViewBridge.sendToWeb(mapOf(
            "type" to "callkit-mute",
            "muted" to state.isMuted,
        ))
    }

    private fun requestAudioFocus() {
        val audioManager = context.getSystemService(AudioManager::class.java)
        audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .build()
        audioManager.requestAudioFocus(audioFocusRequest!!)
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    }

    private fun releaseAudioFocus() {
        val audioManager = context.getSystemService(AudioManager::class.java)
        audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        audioManager.mode = AudioManager.MODE_NORMAL
        audioFocusRequest = null
    }
}
