import UIKit
import PushKit

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Push notification and VoIP registration happens after login,
        // triggered by the web app via the JS bridge (auth-state message).
        // This avoids prompting before the user has even signed in.

        // Check for deep link commands passed as launch arguments
        // Usage: xcrun simctl launch ... net.forumline.app "forumline://login?email=...&password=..."
        let args = ProcessInfo.processInfo.arguments
        for arg in args.dropFirst() { // skip executable path
            if arg.hasPrefix("forumline://"), let url = URL(string: arg) {
                // Delay to let the webview load first
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    DeepLinkHandler.shared.handle(url: url)
                }
                break
            }
        }

        return true
    }

    /// Called by PushManager after the user logs in
    func registerForPush() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
        VoIPPushManager.shared.register()
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        PushManager.shared.apnsToken = token
        print("[Forumline] APNs token: \(token)")
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[Forumline] APNs registration failed: \(error)")
    }
}
