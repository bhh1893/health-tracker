# The zone is read, never created: creating it is tied to the nameserver change
# at Porkbun, a manual step in docs/runbooks/cloudflare.md (ADR 0029).
data "cloudflare_zone" "this" {
  filter = {
    name = local.zone_name
  }
}

locals {
  zone_name   = "nibblejiggle.xyz"
  hostname    = "app.${local.zone_name}"
  tunnel_name = "health-tracker"
  zone_id     = data.cloudflare_zone.this.zone_id
  account_id  = data.cloudflare_zone.this.account.id

  # The Service Cilium generates for Gateway `edge` (k8s/platform/edge/gateway.yaml).
  gateway_origin = "https://cilium-gateway-edge.edge.svc.cluster.local:443"
}
