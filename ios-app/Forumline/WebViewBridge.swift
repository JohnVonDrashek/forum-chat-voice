import WebKit

/// Singleton for native → web messaging
class WebViewBridge {
    static let shared = WebViewBridge()
    weak var webView: WKWebView?

    func sendToWeb(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              let jsonString = String(data: data, encoding: .utf8)
        else { return }

        let js = "window.forumlineNativeBridge?.onMessage(\(jsonString));"
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(js) { _, error in
                if let error = error {
                    print("[Forumline] Bridge send error: \(error)")
                }
            }
        }
    }
}
