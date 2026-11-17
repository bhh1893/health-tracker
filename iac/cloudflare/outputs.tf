# For the runbook: dropping old connections after a token rotation needs it.
output "tunnel_id" {
  value = cloudflare_zero_trust_tunnel_cloudflared.health.id
}
