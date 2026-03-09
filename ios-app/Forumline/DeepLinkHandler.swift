import UIKit

/// Handles forumline:// deep links for programmatic control of the app.
///
/// Supported deep links:
///   forumline://login?email=EMAIL&password=PASSWORD   — Auto-fill and submit login form
///   forumline://navigate?path=/conversations           — Navigate to a web app route
///   forumline://js?code=ENCODED_JS                     — Execute arbitrary JavaScript (debug)
///   forumline://allow-notifications                    — Trigger push notification registration
///   forumline://screenshot                             — Log current URL (for debugging)
///
/// Usage from terminal:
///   xcrun simctl openurl "iPhone 17 Pro" "forumline://login?email=test@example.com&password=test1234"
///
class DeepLinkHandler {
    static let shared = DeepLinkHandler()

    func handle(url: URL) {
        guard url.scheme == "forumline" else { return }
        let command = url.host ?? ""
        let params = Self.queryParams(from: url)

        print("[Forumline] Deep link: \(command) params=\(params.keys.joined(separator: ","))")

        switch command {
        case "login":
            handleLogin(params: params)
        case "navigate":
            handleNavigate(params: params)
        case "js":
            handleJS(params: params)
        case "allow-notifications":
            handleAllowNotifications()
        case "tap":
            handleTap(params: params)
        default:
            print("[Forumline] Unknown deep link command: \(command)")
        }
    }

    // MARK: - Commands

    private func handleLogin(params: [String: String]) {
        guard let email = params["email"], let password = params["password"] else {
            print("[Forumline] login requires email and password params")
            return
        }
        // Fill the login form and submit via JavaScript
        let js = """
        (function() {
            var inputs = document.querySelectorAll('input');
            var emailInput = null, pwInput = null;
            for (var i = 0; i < inputs.length; i++) {
                if (inputs[i].type === 'email') emailInput = inputs[i];
                if (inputs[i].type === 'password') pwInput = inputs[i];
            }
            if (emailInput && pwInput) {
                // Set values and dispatch input events so the app state updates
                var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                nativeSet.call(emailInput, '\(email.replacingOccurrences(of: "'", with: "\\'"))');
                emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                nativeSet.call(pwInput, '\(password.replacingOccurrences(of: "'", with: "\\'"))');
                pwInput.dispatchEvent(new Event('input', { bubbles: true }));
                // Submit the form
                var form = emailInput.closest('form');
                if (form) {
                    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                }
                return 'login submitted';
            }
            return 'login form not found';
        })();
        """
        evaluateJS(js)
    }

    private func handleNavigate(params: [String: String]) {
        guard let path = params["path"] else {
            print("[Forumline] navigate requires path param")
            return
        }
        // Use the web app's router or just set window.location.hash
        let js = "window.location.hash = '\(path.replacingOccurrences(of: "'", with: "\\'"))';"
        evaluateJS(js)
    }

    private func handleJS(params: [String: String]) {
        guard let code = params["code"] else {
            print("[Forumline] js requires code param")
            return
        }
        evaluateJS(code)
    }

    private func handleAllowNotifications() {
        if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
            appDelegate.registerForPush()
        }
    }

    private func handleTap(params: [String: String]) {
        guard let selector = params["selector"] else {
            print("[Forumline] tap requires selector param")
            return
        }
        let js = """
        (function() {
            var el = document.querySelector('\(selector.replacingOccurrences(of: "'", with: "\\'"))');
            if (el) { el.click(); return 'tapped'; }
            return 'element not found: \(selector.replacingOccurrences(of: "'", with: "\\'"))';
        })();
        """
        evaluateJS(js)
    }

    // MARK: - Helpers

    private func evaluateJS(_ js: String) {
        DispatchQueue.main.async {
            WebViewBridge.shared.webView?.evaluateJavaScript(js) { result, error in
                if let error = error {
                    print("[Forumline] JS error: \(error)")
                } else if let result = result {
                    print("[Forumline] JS result: \(result)")
                }
            }
        }
    }

    private static func queryParams(from url: URL) -> [String: String] {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = components.queryItems
        else { return [:] }
        var params: [String: String] = [:]
        for item in items {
            params[item.name] = item.value
        }
        return params
    }
}
