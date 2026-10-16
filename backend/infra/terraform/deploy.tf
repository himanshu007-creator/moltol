locals {
  nip_io_host     = "${var.app_subdomain}.${aws_eip.app.public_ip}.${var.domain_suffix}"
  site_address    = var.enable_https ? local.nip_io_host : ":80"
  public_base_url = var.enable_https ? "https://${local.nip_io_host}" : "http://${aws_eip.app.public_ip}"

  env_template_args = {
    postgres_user        = "moltol"
    postgres_password    = random_password.postgres.result
    postgres_db          = "moltol"
    image_tag            = var.image_tag
    site_address         = local.site_address
    public_base_url      = local.public_base_url
    paypal_env           = var.paypal_env
    paypal_client_id     = var.paypal_client_id
    paypal_client_secret = var.paypal_client_secret
    paypal_webhook_id    = var.paypal_webhook_id
    allow_mock_payments  = var.allow_mock_payments
    llm_base_url         = var.llm_base_url
    llm_api_key          = var.llm_api_key
    llm_model            = var.llm_model
    channel3_api_key     = var.channel3_api_key
    seal_key             = var.seal_key
    jwt_secret           = random_password.jwt.result
    smtp_user            = var.smtp_user
    smtp_password        = var.smtp_password
    email_from           = var.email_from
  }
}

# Snapshot the local repo (workspace root) so no git repo or credentials are
# needed on the instance. The Docker images build from this source.
data "archive_file" "src" {
  type        = "tar.gz"
  source_dir  = "${path.module}/../.."
  output_path = "${path.module}/moltol-src.tar.gz"

  excludes = [
    ".git",
    ".git/**",
    "**/node_modules",
    "**/node_modules/**",
    "**/dist",
    "**/dist/**",
    "**/.turbo",
    "**/.turbo/**",
    "infra/terraform/.terraform",
    "infra/terraform/.terraform/**",
    "**/*.tfstate",
    "**/*.tfstate.*",
    "**/*.tfvars",
    "**/*.tar.gz",
    ".env",
    "**/coverage",
    "**/coverage/**",
    ".DS_Store",
  ]
}

# Deploy (build + run) the Docker stack on the instance. Re-runs when the source
# snapshot, replica counts, or generated env change. cloud-init installed Docker,
# this provisions the stack from the uploaded tarball.
resource "null_resource" "deploy" {
  depends_on = [aws_instance.app, aws_eip.app, aws_security_group.app]

  triggers = {
    instance_id     = aws_instance.app.id
    src_hash        = data.archive_file.src.output_base64sha256
    image_tag       = var.image_tag
    api_replicas    = var.api_replicas
    worker_replicas = var.worker_replicas
    site_address    = local.site_address
    env_hash        = sha256(templatefile("${path.module}/templates/env.tftpl", local.env_template_args))
  }

  connection {
    type        = "ssh"
    host        = aws_eip.app.public_ip
    user        = "ubuntu" # default login user on the Ubuntu EC2 image
    private_key = file(pathexpand(var.ssh_private_key_path))
    timeout     = "10m"
  }

  provisioner "remote-exec" {
    inline = [
      # A prior failed run left a stray file at /home/ubuntu/moltol (the file
      # provisioner can't create parent dirs). Ensure it is a clean directory
      # before any uploads.
      "rm -f /home/ubuntu/moltol 2>/dev/null || true; mkdir -p /home/ubuntu/moltol",
    ]
  }

  provisioner "file" {
    source      = data.archive_file.src.output_path
    destination = "/home/ubuntu/moltol/src.tar.gz"
  }

  provisioner "file" {
    content     = templatefile("${path.module}/templates/env.tftpl", local.env_template_args)
    destination = "/home/ubuntu/moltol/.env"
  }

  provisioner "file" {
    content = templatefile("${path.module}/templates/deploy.sh.tftpl", {
      repo_subdir     = var.repo_subdir
      api_replicas    = var.api_replicas
      worker_replicas = var.worker_replicas
      image_tag       = var.image_tag
    })
    destination = "/home/ubuntu/moltol/deploy.sh"
  }

  provisioner "remote-exec" {
    inline = [
      "chmod +x /home/ubuntu/moltol/deploy.sh",
      "for i in $(seq 1 60); do [ -f /home/ubuntu/.cloud-init-done ] && break; sleep 5; done",
      "rm -rf /home/ubuntu/moltol/repo && mkdir -p /home/ubuntu/moltol/repo",
      "tar -xzf /home/ubuntu/moltol/src.tar.gz -C /home/ubuntu/moltol/repo",
      "bash /home/ubuntu/moltol/deploy.sh",
    ]
  }
}