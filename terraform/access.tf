# Zero Trust Access: protect SSH endpoints behind Cloudflare Access.
#
# Two policies per application:
#   1. Service Auth — lets GitHub Actions deploy via service token (no browser)
#   2. Allow       — lets the developer through with email-based identity
#
# cloudflared access ssh authenticates using either:
#   - Browser login (developer)
#   - --id / --secret flags (GitHub Actions)

# ---------------------------------------------------------------------------
# Service token for GitHub Actions deploys
# ---------------------------------------------------------------------------

resource "cloudflare_zero_trust_access_service_token" "github_actions" {
  account_id = var.cloudflare_account_id
  name       = "GitHub Actions Deploy"
}

# ---------------------------------------------------------------------------
# Local map of SSH hostnames → friendly names
# ---------------------------------------------------------------------------

locals {
  ssh_hostnames = {
    "ssh"        = { hostname = "ssh.forumline.net", name = "Demo Forum SSH" }
    "app-ssh"    = { hostname = "app-ssh.forumline.net", name = "Forumline App SSH" }
    "www-ssh"    = { hostname = "www-ssh.forumline.net", name = "Website SSH" }
    "hosted-ssh" = { hostname = "hosted-ssh.forumline.net", name = "Hosted Platform SSH" }
  }
}

# ---------------------------------------------------------------------------
# Access Applications (one per SSH hostname)
# ---------------------------------------------------------------------------

resource "cloudflare_zero_trust_access_application" "ssh" {
  for_each = local.ssh_hostnames

  account_id       = var.cloudflare_account_id
  name             = each.value.name
  domain           = each.value.hostname
  type             = "self_hosted"
  session_duration = "24h"

  # SSH connections don't go through a browser; skip the identity page
  auto_redirect_to_identity = false
}

# ---------------------------------------------------------------------------
# Policy: Service Auth — GitHub Actions (evaluated first, no browser login)
# ---------------------------------------------------------------------------

resource "cloudflare_zero_trust_access_policy" "ssh_service_auth" {
  for_each = local.ssh_hostnames

  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.ssh[each.key].id
  name           = "${each.value.name} — Service Token"
  precedence     = 1
  decision       = "non_identity"

  include {
    service_token = [cloudflare_zero_trust_access_service_token.github_actions.id]
  }
}

# ---------------------------------------------------------------------------
# Short-lived SSH certificates
# Cloudflare signs ephemeral certs after browser-based Access login.
# The CA public key is installed on each LXC in /etc/ssh/ca.pub.
# Note: service tokens (GitHub Actions) cannot obtain short-lived certs —
# CI/CD continues using traditional SSH keys for sshd auth.
# ---------------------------------------------------------------------------

resource "cloudflare_zero_trust_access_short_lived_certificate" "ssh" {
  for_each       = local.ssh_hostnames
  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.ssh[each.key].id
}

# ---------------------------------------------------------------------------
# Policy: Allow — Developer email (browser-based login)
# ---------------------------------------------------------------------------

resource "cloudflare_zero_trust_access_policy" "ssh_allow_developer" {
  for_each = local.ssh_hostnames

  account_id     = var.cloudflare_account_id
  application_id = cloudflare_zero_trust_access_application.ssh[each.key].id
  name           = "${each.value.name} — Developer"
  precedence     = 2
  decision       = "allow"

  include {
    email = [var.developer_email]
  }
}
