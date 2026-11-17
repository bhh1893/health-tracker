# For the runbook: dropping old connections after a token rotation needs it (secrets.md).
output "tunnel_id" {
  value = cloudflare_zero_trust_tunnel_cloudflared.health.id
}

# Not a secret: it appears in every dashboard URL. With tunnel_id, it addresses the
# tunnel in the API call that drops old connections (secrets.md, "Tunnel token").
output "account_id" {
  value = local.account_id
}
