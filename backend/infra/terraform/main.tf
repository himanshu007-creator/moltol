provider "digitalocean" {
  token = var.do_token # falls back to DIGITALOCEAN_TOKEN env var when null
}

resource "random_password" "postgres" {
  length  = 32
  special = false
}

# Register the local public key with the DO account so the droplet trusts it.
resource "digitalocean_ssh_key" "deployer" {
  name       = "${var.droplet_name}-deployer"
  public_key = trimspace(file(pathexpand(var.ssh_public_key_path)))
}

resource "digitalocean_droplet" "app" {
  name     = var.droplet_name
  region   = var.region
  size     = var.droplet_size
  image    = "ubuntu-24-04-x64"
  ssh_keys = [digitalocean_ssh_key.deployer.id]
  tags     = ["moltol"]

  user_data = templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {})

  lifecycle {
    ignore_changes = [user_data] # cloud-init only runs on first boot
  }
}

resource "digitalocean_firewall" "app" {
  name        = "${var.droplet_name}-fw"
  droplet_ids = [digitalocean_droplet.app.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_allowed_cidrs
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
