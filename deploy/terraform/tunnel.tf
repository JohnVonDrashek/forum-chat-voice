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
    # Website (forumline.net) is on Cloudflare Pages — no tunnel route needed

    # Zitadel Auth — auth.forumline.net
    # HTTP/2 origin required for gRPC; Traefik proxies to Zitadel API + Login UI
    ingress_rule {
      hostname = "auth.forumline.net"
      service  = "http://192.168.1.110:8080"
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

    # LiveKit SFU — livekit.forumline.net (WebSocket signaling only)
    # UDP media ports are port-forwarded directly on the router
    ingress_rule {
      hostname = "livekit.forumline.net"
      service  = "http://192.168.1.111:7880"
    }

    # Forumline Identity Service — id.forumline.net
    # "Sign in with Forumline" OAuth proxy, co-located with Zitadel on auth-prod
    ingress_rule {
      hostname = "id.forumline.net"
      service  = "http://192.168.1.110:3000"
    }

    # GlitchTip Error Tracking — errors.forumline.net
    # Co-located on logs-prod LXC alongside VictoriaLogs
    ingress_rule {
      hostname = "errors.forumline.net"
      service  = "http://192.168.1.108:8000"
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
