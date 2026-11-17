# Each phase holds one ruleset per zone; Terraform owns the whole ruleset, so a
# rule added in the dashboard shows as drift on the next plan.

# The one rate limiting rule Free allows (ADR 0027). Free counts per IP per
# Cloudflare data centre (both characteristics are mandatory), and allows only a
# 10 s period and a 10 s block.
resource "cloudflare_ruleset" "rate_limit" {
  zone_id = local.zone_id
  name    = "rate limits"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules = [
    {
      ref         = "oauth2_per_ip"
      description = "Sign-in paths: 20 requests per 10 s per IP (ADR 0027)"
      expression  = "starts_with(http.request.uri.path, \"/oauth2/\")"
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 10
        requests_per_period = 20
        mitigation_timeout  = 10
      }
    },
  ]
}

# Level 2 of the Sign-up brake (ADR 0026, amended by 0029). Kept in place and
# switched with the variable, so pulling it is one apply and leaves no drift.
resource "cloudflare_ruleset" "custom" {
  zone_id = local.zone_id
  name    = "custom rules"
  kind    = "zone"
  phase   = "http_request_firewall_custom"

  rules = [
    {
      ref         = "signup_brake"
      description = "Sign-up brake level 2: block /oauth2/start (ADR 0026)"
      expression  = "http.request.uri.path eq \"/oauth2/start\""
      action      = "block"
      enabled     = var.signup_brake_edge
    },
  ]
}
