variable "cloudflare_api_token" {
  description = "Cloudflare API token with tunnel edit permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "tunnel_id" {
  description = "Cloudflare Tunnel ID"
  type        = string
  default     = "b00696cc-c867-42d0-8649-6367b96abd64"
}

variable "developer_email" {
  description = "Email address of the developer allowed SSH access"
  type        = string
}

variable "state_encryption_passphrase" {
  description = "Passphrase for encrypting state and plan files (OpenTofu 1.7+)"
  type        = string
  sensitive   = true
}
