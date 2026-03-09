import PushKit

class VoIPPushManager: NSObject, PKPushRegistryDelegate {
    static let shared = VoIPPushManager()

    private var registry: PKPushRegistry?

    func register() {
        registry = PKPushRegistry(queue: .main)
        registry?.delegate = self
        registry?.desiredPushTypes = [.voIP]
    }

    // MARK: - PKPushRegistryDelegate

    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        PushManager.shared.voipToken = token
        PushManager.shared.registerTokensWithServer()
        print("[Forumline] VoIP token: \(token)")
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        let data = payload.dictionaryPayload
        let callId = data["call_id"] as? String ?? UUID().uuidString
        let callerName = data["caller_name"] as? String ?? "Incoming Call"
        let conversationId = data["conversation_id"] as? String

        // Must report to CallKit immediately or iOS kills the app
        CallManager.shared.reportIncomingCall(callId: callId, callerName: callerName) { _ in
            // Also notify the web app so it can connect SSE and prepare WebRTC
            var msg: [String: Any] = [
                "type": "voip-incoming",
                "callId": callId,
                "callerName": callerName,
            ]
            if let cid = conversationId { msg["conversationId"] = cid }
            WebViewBridge.shared.sendToWeb(msg)

            completion()
        }
    }
}
