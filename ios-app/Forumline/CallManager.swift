import CallKit
import AVFoundation

class CallManager: NSObject {
    static let shared = CallManager()

    private let provider: CXProvider
    private let callController = CXCallController()
    private var activeCallUUID: UUID?
    private var activeCallId: String?
    private var pendingAnswer = false

    override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = false
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        config.iconTemplateImageData = nil // TODO: add app icon
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    /// Report an incoming call to CallKit (shows native call UI)
    func reportIncomingCall(callId: String, callerName: String, completion: ((Error?) -> Void)? = nil) {
        let uuid = UUID()
        activeCallUUID = uuid
        activeCallId = callId

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerName)
        update.localizedCallerName = callerName
        update.hasVideo = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false

        provider.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error = error {
                print("[Forumline] Failed to report incoming call: \(error)")
                self.activeCallUUID = nil
                self.activeCallId = nil
            }
            completion?(error)
        }
    }

    /// Report that the call connected (updates CallKit UI)
    func reportCallConnected(callId: String) {
        guard let uuid = activeCallUUID else { return }
        provider.reportOutgoingCall(with: uuid, connectedAt: Date())
    }

    /// Report that the call ended
    func reportCallEnded() {
        guard let uuid = activeCallUUID else { return }
        provider.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
        activeCallUUID = nil
        activeCallId = nil
        pendingAnswer = false
    }

    /// Check if there's a pending answer from CallKit (for VoIP push wake-up)
    func consumePendingAnswer() -> String? {
        guard pendingAnswer, let callId = activeCallId else { return nil }
        pendingAnswer = false
        return callId
    }
}

extension CallManager: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        activeCallUUID = nil
        activeCallId = nil
        pendingAnswer = false
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        // Configure audio session for voice chat
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
        try? session.setActive(true)

        // Tell web app to accept the call
        if let callId = activeCallId {
            WebViewBridge.shared.sendToWeb([
                "type": "callkit-answer",
                "callId": callId,
            ])
        } else {
            pendingAnswer = true
        }

        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        // Tell web app to end the call
        if let callId = activeCallId {
            WebViewBridge.shared.sendToWeb([
                "type": "callkit-end",
                "callId": callId,
            ])
        }

        activeCallUUID = nil
        activeCallId = nil
        pendingAnswer = false

        // Reset audio session
        try? AVAudioSession.sharedInstance().setActive(false)

        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        WebViewBridge.shared.sendToWeb([
            "type": "callkit-mute",
            "muted": action.isMuted,
        ])
        action.fulfill()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        print("[Forumline] Audio session activated")
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        print("[Forumline] Audio session deactivated")
    }
}
