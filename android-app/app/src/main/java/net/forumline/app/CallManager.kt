package net.forumline.app

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log

/**
 * Manages native call UI via Android Telecom framework.
 * Android equivalent of iOS CallManager (CallKit).
 */
object CallManager {
    private const val TAG = "Forumline"
    private const val PHONE_ACCOUNT_ID = "forumline_voip"

    var activeCallId: String? = null
    var activeConnection: CallConnection? = null

    private fun getPhoneAccountHandle(context: Context): PhoneAccountHandle {
        return PhoneAccountHandle(
            ComponentName(context, CallConnectionService::class.java),
            PHONE_ACCOUNT_ID
        )
    }

    fun registerPhoneAccount(context: Context) {
        val telecomManager = context.getSystemService(TelecomManager::class.java)
        val handle = getPhoneAccountHandle(context)
        val account = android.telecom.PhoneAccount.builder(handle, "Forumline")
            .setCapabilities(android.telecom.PhoneAccount.CAPABILITY_SELF_MANAGED)
            .build()
        telecomManager.registerPhoneAccount(account)
    }

    fun reportIncomingCall(context: Context, callId: String, callerName: String) {
        activeCallId = callId
        val telecomManager = context.getSystemService(TelecomManager::class.java)
        val extras = Bundle().apply {
            putString("call_id", callId)
            putString("caller_name", callerName)
            putParcelable(
                TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE,
                getPhoneAccountHandle(context)
            )
        }
        try {
            telecomManager.addNewIncomingCall(getPhoneAccountHandle(context), extras)
        } catch (e: SecurityException) {
            Log.e(TAG, "Cannot add incoming call (permission denied)", e)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to report incoming call", e)
        }
    }

    fun reportCallConnected(callId: String) {
        activeConnection?.setActive()
    }

    fun reportCallEnded() {
        activeConnection?.let {
            it.setDisconnected(android.telecom.DisconnectCause(android.telecom.DisconnectCause.REMOTE))
            it.destroy()
        }
        activeConnection = null
        activeCallId = null
    }
}
