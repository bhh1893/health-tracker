# Remotely managed tunnel (ADR 0029): Cloudflare holds the routes below and sends
# them to cloudflared, which runs on a token alone. No tunnel_secret here: Cloudflare
# generates it, and Terraform never reads it or the token, so state holds no secret.
resource "cloudflare_zero_trust_tunnel_cloudflared" "health" {
  account_id = local.account_id
  name       = local.tunnel_name
  config_src = "cloudflare"

  # Replacing the tunnel means a new token and an outage until the CNAME and the
  # cluster's Secret catch up. On state loss, import it instead (runbook).
  lifecycle {
    prevent_destroy = true
  }
}

# The tunnel's routes, read top to bottom; the first match wins.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "health" {
  account_id = local.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.health.id
  source     = "cloudflare"

  config = {
    ingress = [
      {
        hostname = local.hostname
        service  = local.gateway_origin
        origin_request = {
          # The SNI cloudflared sends, and the name it checks the Gateway's
          # certificate against (ADR 0025). Never noTLSVerify.
          origin_server_name = local.hostname
        }
      },
      {
        # Anything else that reaches this tunnel gets a 404, so a mistaken route
        # fails closed instead of publishing something (ADR 0025).
        service = "http_status:404"
      },
    ]
  }
}

# Orange cloud: browsers get Cloudflare's addresses, and Cloudflare sends the
# request down the tunnel. Works only because zone and tunnel share one account.
resource "cloudflare_dns_record" "health" {
  zone_id = local.zone_id
  name    = local.hostname # full name: a short one reads back different and shows as drift
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.health.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1 # "automatic", the only value a proxied record takes
  comment = "Terraform: iac/cloudflare"
}
