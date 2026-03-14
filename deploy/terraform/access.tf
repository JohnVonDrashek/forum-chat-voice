# Zero Trust Access: protect SSH bastion for CI deploys.
#
# Only one SSH hostname (ssh.forumline.net) pointing to Proxmox host.
# GitHub Actions authenticates via service token.
# Developer access goes through WireGuard VPN — no Cloudflare SSH needed.

# ---------------------------------------------------------------------------
# Service token for GitHub Actions deploys
# ---------------------------------------------------------------------------

resource "cloudflare_zero_trust_access_service_token" "github_actions" {
  account_id = var.cloudflare_account_id
  name       = "GitHub Actions Deploy"
}

# ---------------------------------------------------------------------------
# Access Application — SSH bastion
# ---------------------------------------------------------------------------

resource "cloudflare_zero_trust_access_application" "ssh_bastion" {
  account_id       = var.cloudflare_account_id
  name             = "SSH Bastion (CI)"
  domain           = "ssh.forumline.net"
  type             = "self_hosted"
  session_duration = "24h"

  auto_redirect_to_identity = false
}

# ---------------------------------------------------------------------------
# Policy: Service Auth — GitHub Actions only
# ---------------------------------------------------------------------------

resource "cloudflare_zero_trust_access_policy" "ssh_service_auth" {
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.ssh_bastion.id
  name           = "SSH Bastion — CI Service Token"
  precedence     = 1
  decision       = "non_identity"

  include {
    service_token = [cloudflare_zero_trust_access_service_token.github_actions.id]
  }
}
