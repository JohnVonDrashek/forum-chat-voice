import Foundation

class PushManager {
    static let shared = PushManager()

    var apnsToken: String?
    var voipToken: String?
    var accessToken: String?

    private let serverURL = "https://app.forumline.net"

    /// Register both APNs and VoIP tokens with the Forumline server
    func registerTokensWithServer() {
        guard let accessToken = accessToken else { return }

        if let token = apnsToken {
            registerToken(token, type: "apns", accessToken: accessToken)
        }
        if let token = voipToken {
            registerToken(token, type: "voip", accessToken: accessToken)
        }
    }

    private func registerToken(_ token: String, type: String, accessToken: String) {
        guard let url = URL(string: "\(serverURL)/api/push?action=subscribe-apns") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "device_token": token,
            "token_type": type,
        ])

        URLSession.shared.dataTask(with: request) { _, response, error in
            if let error = error {
                print("[Forumline] Failed to register \(type) token: \(error)")
                return
            }
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                print("[Forumline] Registered \(type) token with server")
            }
        }.resume()
    }
}
