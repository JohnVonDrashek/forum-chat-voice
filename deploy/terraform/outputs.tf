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
