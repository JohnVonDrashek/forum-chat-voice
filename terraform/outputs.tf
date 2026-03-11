output "tunnel_id" {
  description = "Cloudflare Tunnel ID"
  value       = var.tunnel_id
}

output "github_actions_service_token_id" {
  description = "CF-Access-Client-Id for GitHub Actions"
  value       = cloudflare_zero_trust_access_service_token.github_actions.client_id
  sensitive   = true
}

output "github_actions_service_token_secret" {
  description = "CF-Access-Client-Secret for GitHub Actions (only available on create)"
  value       = cloudflare_zero_trust_access_service_token.github_actions.client_secret
  sensitive   = true
}

output "ssh_ca_public_keys" {
  description = "CA public keys for short-lived SSH certificates — install in /etc/ssh/ca.pub on each LXC"
  value       = { for k, v in cloudflare_zero_trust_access_short_lived_certificate.ssh : k => v.public_key }
}
