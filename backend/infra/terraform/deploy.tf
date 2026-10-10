locals {
  nip_io_host  = "${var.app_subdomain}.${digitalocean_droplet.app.ipv4_address}.${var.domain_suffix}"
  site_address = var.enable_https ? local.nip_io_host : ":80"
}

# Deploy (build + run) the Docker stack on the droplet. Re-runs when the ref,
# replica counts, or generated env change. This is the "Terraform deploys
# Docker" step: cloud-init installs the engine, this provisions the stack.
resource "null_resource" "deploy" {
  depends_on = [digitalocean_droplet.app, digitalocean_firewall.app]

  triggers = {
    droplet_id      = digitalocean_droplet.app.id
    repo_url        = var.repo_url
    git_ref         = var.git_ref
    repo_subdir     = var.repo_subdir
    image_tag       = var.image_tag
    api_replicas    = var.api_replicas
    worker_replicas = var.worker_replicas
    site_address    = local.site_address
    env_hash = sha256(templatefile("${path.module}/templates/env.tftpl", {
      postgres_user     = "moltol"
      postgres_password = random_password.postgres.result
      postgres_db       = "moltol"
      image_tag         = var.image_tag
      site_address      = local.site_address
    }))
  }

  connection {
    type        = "ssh"
    host        = digitalocean_droplet.app.ipv4_address
    user        = "root"
    private_key = file(pathexpand(var.ssh_private_key_path))
    timeout     = "10m"
  }

  provisioner "file" {
    content = templatefile("${path.module}/templates/env.tftpl", {
      postgres_user     = "moltol"
      postgres_password = random_password.postgres.result
      postgres_db       = "moltol"
      image_tag         = var.image_tag
      site_address      = local.site_address
    })
    destination = "/opt/moltol/.env"
  }

  provisioner "file" {
    content = templatefile("${path.module}/templates/deploy.sh.tftpl", {
      repo_url        = var.repo_url
      git_ref         = var.git_ref
      repo_subdir     = var.repo_subdir
      api_replicas    = var.api_replicas
      worker_replicas = var.worker_replicas
      image_tag       = var.image_tag
      site_address    = local.site_address
    })
    destination = "/opt/moltol/deploy.sh"
  }

  provisioner "remote-exec" {
    inline = [
      "install -d -m 0700 /opt/moltol",
      "chmod +x /opt/moltol/deploy.sh",
      "for i in $(seq 1 60); do [ -f /opt/moltol/.cloud-init-done ] && break; sleep 5; done",
      "bash /opt/moltol/deploy.sh",
    ]
  }
}
