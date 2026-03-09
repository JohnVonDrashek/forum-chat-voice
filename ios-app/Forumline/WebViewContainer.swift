import SwiftUI
import WebKit

struct WebViewContainer: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Allow inline media playback (critical for WebRTC audio)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // Inject the native bridge script at document start
        let bridgeScript = WKUserScript(
            source: Self.bridgeJS,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(bridgeScript)

        // Register the message handler for web → native communication
        config.userContentController.add(
            context.coordinator,
            name: "forumlineNative"
        )

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 15/255, green: 23/255, blue: 42/255, alpha: 1) // --color-bg: #0f172a

        // Enable Safari Web Inspector for debugging
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }

        // Allow back/forward swipe gestures
        webView.allowsBackForwardNavigationGestures = true

        // Disable pinch-to-zoom and auto-zoom at the scroll view level
        webView.scrollView.minimumZoomScale = 1.0
        webView.scrollView.maximumZoomScale = 1.0

        // Store reference for native → web messaging
        WebViewBridge.shared.webView = webView

        // Load the production app
        let url = URL(string: "https://app.forumline.net")!
        webView.load(URLRequest(url: url))

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> WebViewCoordinator {
        WebViewCoordinator()
    }

    /// JavaScript injected at document start to set up the native bridge
    /// and prevent iOS auto-zoom on input focus
    private static let bridgeJS = """
    // Prevent iOS zoom on input focus: override viewport meta tag
    (function() {
        var meta = document.querySelector('meta[name=viewport]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'viewport';
            var head = document.head || document.documentElement;
            head.appendChild(meta);
        }
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

        // Also inject CSS to force 16px font on inputs (belt and suspenders)
        var style = document.createElement('style');
        style.textContent = 'input, select, textarea { font-size: 16px !important; }';
        (document.head || document.documentElement).appendChild(style);

        // Re-apply after page fully loads (SPA may recreate viewport meta)
        document.addEventListener('DOMContentLoaded', function() {
            var m = document.querySelector('meta[name=viewport]');
            if (m) m.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
        });
    })();

    window.__FORUMLINE_IOS__ = true;
    window.forumlineNative = {
        postMessage: function(msg) {
            window.webkit.messageHandlers.forumlineNative.postMessage(
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
    """
}

/// Handles messages from web → native
class WebViewCoordinator: NSObject, WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? String,
              let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String
        else { return }

        switch type {
        case "call-state":
            handleCallState(json)
        case "auth-state":
            handleAuthState(json)
        default:
            print("[Forumline] Unknown bridge message: \(type)")
        }
    }

    private func handleCallState(_ json: [String: Any]) {
        guard let state = json["state"] as? String else { return }

        switch state {
        case "ringing-incoming":
            let callId = json["callId"] as? String ?? ""
            let callerName = json["callerName"] as? String ?? "Unknown"
            CallManager.shared.reportIncomingCall(
                callId: callId,
                callerName: callerName
            )
        case "active":
            let callId = json["callId"] as? String ?? ""
            CallManager.shared.reportCallConnected(callId: callId)
        case "idle":
            CallManager.shared.reportCallEnded()
        default:
            break
        }
    }

    private func handleAuthState(_ json: [String: Any]) {
        let token = json["accessToken"] as? String
        PushManager.shared.accessToken = token
        if token != nil {
            PushManager.shared.registerTokensWithServer()
        }
    }
}
