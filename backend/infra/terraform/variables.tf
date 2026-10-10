variable "do_token" {
  description = "DigitalOcean API token (or set DIGITALOCEAN_TOKEN)."
  type        = string
  sensitive   = true
  default     = null
}

variable "region" {
  description = "DigitalOcean region slug."
  type        = string
  default     = "nyc3"
}

variable "droplet_size" {
  description = "Droplet size slug. s-1vcpu-1gb is enough for a demo; bump to s-2vcpu-4gb when scaling api replicas."
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "droplet_name" {
  description = "Droplet hostname."
  type        = string
  default     = "moltol"
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key to register with DigitalOcean."
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

variable "repo_url" {
  description = "Public git URL of the MolTol repo that the VM clones to deploy."
  type        = string
}

variable "git_ref" {
  description = "Git ref (branch/tag/sha) to deploy."
  type        = string
  default     = "main"
}

variable "repo_subdir" {
  description = "Directory inside the repo that contains the Docker stack (the compose file)."
  type        = string
  default     = "backend"
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
