output "instance_ip" {
  description = "Public IPv4 (Elastic IP) of the deployed EC2 instance."
  value       = aws_eip.app.public_ip
}

output "nip_io_host" {
  description = "Free DNS hostname (resolves to the instance via nip.io)."
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
  description = "SSH into the instance."
  value       = "ssh -i ${var.ssh_private_key_path} ubuntu@${aws_eip.app.public_ip}"
}

output "scale_api_hint" {
  description = "How to change the api container count."
  value       = "terraform apply -var=\"api_replicas=4\"  (or on the VM: docker compose --env-file /home/ubuntu/moltol/.env up -d --scale api=4)"
}
