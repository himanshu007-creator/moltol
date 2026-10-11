provider "aws" {
  region = var.aws_region
}

# Latest Ubuntu 24.04 LTS (Canonical) amd64 image — matches the cloud-init below.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

resource "random_password" "postgres" {
  length  = 32
  special = false
}

# Register the local public key as an EC2 key pair so the instance trusts it.
resource "aws_key_pair" "deployer" {
  key_name   = "${var.instance_name}-deployer"
  public_key = trimspace(file(pathexpand(var.ssh_public_key_path)))
}

resource "aws_security_group" "app" {
  name        = "${var.instance_name}-sg"
  description = "MolTol app: ssh + http(s)"

  ingress {
    description      = "ssh"
    from_port        = 22
    to_port          = 22
    protocol         = "tcp"
    cidr_blocks      = local.ssh_ipv4
    ipv6_cidr_blocks = local.ssh_ipv6
  }
  ingress {
    description      = "http"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
  ingress {
    description      = "https"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    description = "all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.instance_name}-sg" }
}

locals {
  ssh_ipv4 = [for c in var.ssh_allowed_cidrs : c if !strcontains(c, ":")]
  ssh_ipv6 = [for c in var.ssh_allowed_cidrs : c if strcontains(c, ":")]
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.deployer.key_name
  vpc_security_group_ids = [aws_security_group.app.id]
  tags                   = { Name = var.instance_name }

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  user_data = templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {})

  lifecycle {
    ignore_changes = [user_data] # cloud-init only runs on first boot
  }
}

# Stable public IP so the nip.io hostname, PUBLIC_BASE_URL, and PayPal webhook
# URL survive instance stop/start.
resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id
  tags     = { Name = "${var.instance_name}-eip" }
}
