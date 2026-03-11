terraform {
  required_version = ">= 1.7, < 2.0"

  backend "s3" {
    bucket                      = "forumline-terraform-state"
    key                         = "tunnel/terraform.tfstate"
    region                      = "us-east-1"
    endpoint                    = "https://b4cf6ac20ef4cd693cd7a81113b8d031.r2.cloudflarestorage.com"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    force_path_style            = true
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # Client-side state encryption (OpenTofu 1.7+).
  # Encrypts state before it leaves your machine / CI runner.
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.state_encryption_passphrase
    }

    method "aes_gcm" "main" {
      keys = key_provider.pbkdf2.main
    }

    state {
      method   = method.aes_gcm.main
      enforced = true
    }

    plan {
      method   = method.aes_gcm.main
      enforced = true
    }
  }
}
