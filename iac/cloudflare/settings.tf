# Browser TLS ends at Cloudflare (ADR 0025), so the http -> https redirect happens
# here; the Gateway has no :80 listener.
resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = local.zone_id
  setting_id = "always_use_https"
  value      = "on"
}

# HSTS (ADR 0025): browsers refuse plain http for this name for 6 months. No
# includeSubDomains, so other names in the zone stay free; no preload, which is
# hard to undo.
resource "cloudflare_zone_setting" "hsts" {
  zone_id    = local.zone_id
  setting_id = "security_header"
  value = {
    strict_transport_security = {
      enabled            = true
      max_age            = 15552000 # 180 days
      include_subdomains = false
      preload            = false
      nosniff            = false
    }
  }
}

# Bot Fight Mode off (ADR 0027): it covers the whole zone, and its challenge page
# breaks the SPA's fetch('/api/...') with no clear error.
resource "cloudflare_bot_management" "this" {
  zone_id    = local.zone_id
  fight_mode = false
}
