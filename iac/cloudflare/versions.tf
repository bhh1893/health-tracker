# Exact pins (ADR 0029). Bumping either is a reviewed one-line change; see
# docs/runbooks/cloudflare.md for the provider, whose lock file must move with it.
terraform {
  required_version = "1.17.2"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.29.0"
    }
  }

  # State stays on the dev VM, outside the repo (ADR 0029). A backend block cannot
  # read variables or expand ~, so the path is passed at init:
  #   terraform init -backend-config="path=$HOME/.config/health-tracker/terraform/cloudflare.tfstate"
  # iac/scripts/cloudflare-terraform does that for you.
  backend "local" {}
}

# The token comes from CLOUDFLARE_API_TOKEN, never from a file Terraform reads,
# so it never lands in state or in the plan.
provider "cloudflare" {}
