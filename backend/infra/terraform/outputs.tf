output "droplet_ip" {
  description = "Public IPv4 of the deployed droplet."
  value       = digitalocean_droplet.app.ipv4_address
}

output "nip_io_host" {
  description = "Free DNS hostname (resolves to the droplet via nip.io)."
  value       = local.nip_io_host
}

output "app_url" {
  description = "Public URL for the API (behind Caddy)."
  value       = var.enable_https ? "https://${local.nip_io_host}" : "http://${local.nip_io_host}"
}

output "health_url" {
  value = var.enable_https ? "https://${local.nip_io_host}/healthz" : "http://${local.nip_io_host}/healthz"
}

output "ssh_command" {
  description = "SSH into the droplet."
  value       = "ssh -i ${var.ssh_private_key_path} root@${digitalocean_droplet.app.ipv4_address}"
}

output "scale_api_hint" {
  description = "How to change the api container count."
  value       = "terraform apply -var=\"api_replicas=4\"  (or on the VM: docker compose --env-file /opt/moltol/.env up -d --scale api=4)"
}
