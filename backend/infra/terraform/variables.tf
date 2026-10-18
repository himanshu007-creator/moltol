variable "aws_region" {
  description = "AWS region. ap-southeast-2 = Sydney (the only region the Free-plan SCP permits for this account)."
  type        = string
  default     = "ap-southeast-2"
}

variable "instance_type" {
  description = "EC2 instance type. Free-plan accounts are limited to free-tier-eligible types. t3.small (2vCPU/2GB) is the minimum that runs the stack."
  type        = string
  default     = "t3.small"
}

variable "instance_name" {
  description = "EC2 instance name/tag."
  type        = string
  default     = "moltol"
}

variable "root_volume_gb" {
  description = "Root EBS volume size (GiB). Docker images need headroom."
  type        = number
  default     = 30
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key to register as an EC2 key pair."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "ssh_private_key_path" {
  description = "Path to the matching SSH private key, used by Terraform to provision the host."
  type        = string
  default     = "~/.ssh/id_ed25519"
}

variable "ssh_allowed_cidrs" {
  description = "CIDRs allowed to SSH (port 22). Restrict this to your IP for safety."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "repo_subdir" {
  description = "Directory inside the deployed source that contains the Docker stack (the compose file). Root workspace."
  type        = string
  default     = "."
}

variable "image_tag" {
  description = "Image tag baked into the compose build."
  type        = string
  default     = "prod"
}

variable "api_replicas" {
  description = "Number of api containers to run (load-balanced by Caddy). Change this to scale."
  type        = number
  default     = 2
  validation {
    condition     = var.api_replicas >= 1 && var.api_replicas <= 20
    error_message = "api_replicas must be between 1 and 20."
  }
}

variable "worker_replicas" {
  description = "Number of worker containers to run."
  type        = number
  default     = 1
  validation {
    condition     = var.worker_replicas >= 1 && var.worker_replicas <= 20
    error_message = "worker_replicas must be between 1 and 20."
  }
}

variable "domain_suffix" {
  description = "Free wildcard DNS suffix. nip.io resolves <anything>.<ip>.nip.io to <ip>."
  type        = string
  default     = "nip.io"
}

variable "app_subdomain" {
  description = "Leftmost label for the nip.io hostname."
  type        = string
  default     = "api"
}

variable "enable_https" {
  description = "Let Caddy request a Let's Encrypt certificate for the nip.io host (needs ports 80/443 reachable)."
  type        = bool
  default     = true
}

# ---- App integrations (all optional; empty = offline fallbacks) --------------

variable "paypal_env" {
  description = "PayPal environment: sandbox or live."
  type        = string
  default     = "sandbox"
}

variable "paypal_client_id" {
  description = "PayPal REST app client id. Empty => mock checkout gateway."
  type        = string
  default     = ""
}

variable "paypal_client_secret" {
  description = "PayPal REST app client secret."
  type        = string
  sensitive   = true
  default     = ""
}

variable "paypal_webhook_id" {
  description = "PayPal webhook id. Empty => only signed simulator events (id WEBHOOK_ID, sandbox) verify."
  type        = string
  default     = ""
}

variable "allow_mock_payments" {
  description = "\"true\" lets the API run with the offline mock checkout (no PayPal keys). Never for a public demo with real payments."
  type        = string
  default     = "false"
}

variable "llm_base_url" {
  description = "OpenAI-compatible base URL. Empty => deterministic offline narrator."
  type        = string
  default     = ""
}

variable "llm_api_key" {
  description = "API key for the LLM provider."
  type        = string
  sensitive   = true
  default     = ""
}

variable "llm_model" {
  description = "Model name for the LLM provider."
  type        = string
  default     = ""
}

variable "channel3_api_key" {
  description = "Channel3 API key for live market comps. Empty => seeded dataset."
  type        = string
  sensitive   = true
  default     = ""
}

variable "serpapi_api_key" {
  description = "SerpAPI key for live market comps (used when Channel3 is unset or fails)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "paypal_settlement_currency" {
  description = "Currency PayPal is charged in; shops still price in DEFAULT_CURRENCY."
  type        = string
  default     = "USD"
}

variable "fx_usd_per_inr" {
  description = "INR -> USD rate applied at checkout (~0.012 = ₹83.33/$1)."
  type        = string
  default     = "0.012"
}

variable "seal_key" {
  description = "32-byte hex key used to AEAD-seal locked limits at rest. Empty => plaintext vault."
  type        = string
  sensitive   = true
  default     = ""
}

variable "smtp_user" {
  description = "SMTP login (Brevo relay) for OTP emails. Empty => codes are only logged by the API."
  type        = string
  default     = ""
}

variable "smtp_password" {
  description = "SMTP key for the relay."
  type        = string
  sensitive   = true
  default     = ""
}

variable "email_from" {
  description = "Verified sender for OTP emails."
  type        = string
  default     = "MolTol <no-reply@moltol.app>"
}
