# Cloudflare Tunnel ingress configuration
# Manages all routing rules for forumline.net services.
# Changes here go through PR review → terraform plan → terraform apply.
#
# IMPORTANT: Rule order matters! Cloudflare evaluates top-to-bottom.
# Specific hostnames MUST come before wildcards, or they'll never match.

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "forumline" {
  account_id = var.cloudflare_account_id
  tunnel_id  = var.tunnel_id

  config {
    # Website — forumline.net
    ingress_rule {
      hostname = "forumline.net"
      service  = "http://192.168.1.106:3000"
    }

    # Demo Forum — demo.forumline.net (localhost because cloudflared runs on this LXC)
    ingress_rule {
      hostname = "demo.forumline.net"
      service  = "http://localhost:3000"
    }

    # Forumline App — app.forumline.net
    ingress_rule {
      hostname = "app.forumline.net"
      service  = "http://192.168.1.99:3000"
    }

    # Hosted Platform API — hosted.forumline.net
    ingress_rule {
      hostname = "hosted.forumline.net"
      service  = "http://192.168.1.107:3000"
    }

    # SSH access for CI deploys — single bastion on Proxmox host
    # Developer SSH goes through WireGuard VPN instead
    ingress_rule {
      hostname = "ssh.forumline.net"
      service  = "ssh://localhost:22"
    }

    # Hosted Forum Tenants — *.forumline.net wildcard (MUST be last before catch-all)
    ingress_rule {
      hostname = "*.forumline.net"
      service  = "http://192.168.1.107:3000"
    }

    # Catch-all (required by Cloudflare)
    ingress_rule {
      service = "http_status:404"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}
