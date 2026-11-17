---
status: accepted
---

# Cloudflare edge as Terraform, `cloudflared` as a plain Deployment in `edge`

Everything at Cloudflare that a decision depends on (the tunnel and its routes, the `health` record, HTTPS and HSTS, Bot Fight Mode, the rate limiting rule, the brake rule) is Terraform in `iac/cloudflare/`, applied by hand from the dev VM. The tunnel is remotely managed, so `cloudflared` runs on a token alone: a plain Deployment of 2 replicas in `edge`, applied by Ansible with the Gateway and fenced by an egress policy. Terraform never sees the tunnel token, so its state holds no secret. Decided in [Tunnel config, credential and rebuild](https://github.com/bhh1893/health-tracker/issues/180), facts in [Public way in to a home cluster](https://github.com/bhh1893/health-tracker/issues/171). Follows ADR 0025 and amends ADR 0009, 0014, 0015 and 0026.

## Edge as code

- **Terraform, `iac/cloudflare/`.** Provider specifics live under `iac/` (ADR 0003); `iac/terraform/` stays reserved for v2 cloud VMs (ADR 0004). Terraform and the provider are pinned exactly (`dev.yml` installs Terraform with a checksum; provider `5.29.0`; `.terraform.lock.hcl` committed). Who bumps them is [Patching internet-facing components](https://github.com/bhh1893/health-tracker/issues/178).
- **Managed:**
  - the tunnel, `config_src = "cloudflare"` (remotely managed), and its ingress rules: `health.nibblejiggle.xyz` -> `https://<Gateway Service>.edge.svc.cluster.local:443` with `originServerName: health.nibblejiggle.xyz`, then the catch-all `http_status:404` (ADR 0025);
  - the proxied `health` CNAME to `<tunnel-uuid>.cfargotunnel.com`;
  - Always Use HTTPS and HSTS (6 months, no `includeSubDomains`, no preload; ADR 0025);
  - Bot Fight Mode off and the `/oauth2/` rate limiting rule (ADR 0027);
  - the level-2 Sign-up brake: a custom rule blocking `/oauth2/start` with `enabled = var.signup_brake_edge`, default `false` (amends ADR 0026: pulling it is a one-line change plus `apply`, and leaves no drift).
- **Manual, in `docs/runbooks/cloudflare.md`:** the account; the zone (read as a data source, because creating it is tied to the nameserver change at Porkbun); DNSSEC (tied to the DS record at Porkbun); both API tokens (Terraform cannot mint the token it runs with); "Under Attack" mode, an emergency click undone afterwards.
- **Local state,** `~/.config/health-tracker/terraform/cloudflare.tfstate`, mode 600, under Claude's read guardrail (ADR 0015). It holds no secret, because the tunnel token never passes through Terraform (below).
- **Applied by the owner** from the dev VM: `terraform plan`, then `apply`. CI runs `terraform fmt -check` and `terraform validate` (`init -backend=false`, no credentials) in `ci-gate` (amends ADR 0014). Claude can write `.tf` files but cannot run `plan`: the token file sits in the denied directory.
- **Lost state** (dev VM gone): the runbook re-adopts the live objects with `terraform import`. Cloudflare keeps serving meanwhile; nothing is recreated.

## Credentials (amends ADR 0015)

| File | Made by | Goes to | Used by |
| --- | --- | --- | --- |
| `cloudflare-tunnel-token` | Dashboard, "Install connector", by hand | Secret `cloudflared` / `token` in `edge`, via `apply-secrets` | `cloudflared`, as `TUNNEL_TOKEN` |
| `cloudflare-terraform-token` | Dashboard, by hand | Nowhere: `CLOUDFLARE_API_TOKEN` at apply time | Terraform |

- Both enter with ADR 0015's hidden-prompt command, run by the owner. `apply-secrets` stops if the tunnel token file is missing and applies the Secret before `cloudflared`.
- **Terraform token scope,** as the dashboard labels it: on the one account, `Cloudflare Tunnel: Edit`; on the one zone, `Zone: Read` (looking the zone up by name), `DNS: Edit`, `Zone Settings: Edit`, `Zone WAF: Edit`, `Bot Management: Edit`. Separate from the DNS-01 token, which is never reused (ADR 0025). It never enters the cluster or CI.
- **Rebuilds:** a cluster rebuild needs no Cloudflare step; `apply-secrets` reloads the same token and the tunnel reconnects. A dev VM rebuild loses the files: copy the tunnel token from the dashboard again (it stays visible for a remotely managed tunnel) and make a new Terraform token.
- **Rotation,** only on suspected exposure (`docs/runbooks/secrets.md`): "Rotate token" in the dashboard, write the file, `apply-secrets`, restart `cloudflared`, then drop the old connections (`DELETE .../cfd_tunnel/<id>/connections`), because existing connectors keep running on the old token until restarted.

## Workload

- **Plain Deployment** from Cloudflare's Kubernetes guide, in `k8s/platform/edge/cloudflared/`, namespace `edge`, applied by the Ansible `platform` role with the Gateway (platform layer, ADR 0016). Args `tunnel --no-autoupdate --metrics 0.0.0.0:2000 run`.
- **2 replicas,** required pod anti-affinity on hostname (one per worker), PodDisruptionBudget `minAvailable: 1`. Replicas are for availability; Cloudflare sends traffic to the nearest one.
- **Liveness on `:2000/ready`,** as in the guide: 200 only with a live connection to Cloudflare. When the home internet is down the pod restarts in a loop, which costs nothing. No readiness probe and no Service: nothing connects to `cloudflared`.
- **Locked down:** non-root, read-only root filesystem, all capabilities dropped, seccomp `RuntimeDefault`, small requests and limits.
- **Egress (`CiliumNetworkPolicy`, ADR 0025):** DNS to kube-dns with Cilium's DNS rule; `region1.v2.argotunnel.com` and `region2.v2.argotunnel.com` on `7844` UDP (QUIC) and TCP (HTTP/2 fallback) through `toFQDNs`; the Gateway on `443`. Nothing else.

## Considered Options

- **Locally managed `config.yml` in a ConfigMap.** Rejected: routes in git with no new tool, but the record, HTTPS, HSTS and both rules stay dashboard clicks that drift unseen; it also needs a credentials file instead of a token.
- **Dashboard only.** Rejected: no history, no review, no drift check.
- **OpenTofu.** Rejected narrowly: a drop-in fork, but Terraform has more docs and answers, and its licence does not touch personal use.
- **Remote backend and CI apply on merge.** Rejected: an extra account for one person, and a zone-wide write token in a public repo's CI (ADR 0017), for config that changes a few times a year.
- **Terraform reads the token** (generated `tunnel_secret` or the token data source). Rejected: it puts the secret in state, which then needs the protection a remote backend would demand.
- **Cloudflare's Helm charts.** Rejected: no commit since September 2024; the guide's Deployment is about 40 lines.
- **Argo CD owns `cloudflared`.** Rejected: with remote config its manifest rarely changes; it belongs with the Gateway it fronts.
- **`toCIDR` with Cloudflare's published tunnel ranges.** Rejected: easier to read, but breaks silently if Cloudflare renumbers.
- **On dev VM loss, recreate instead of import.** Rejected: a new tunnel means a new token and an outage until the CNAME and Secret catch up.

## Consequences

- First Terraform in the repo; `dev.yml` installs it (amends ADR 0009). The dev VM now also holds the Cloudflare state, beside the secrets and backups it already holds.
- Changing an edge setting by dashboard is drift; `terraform plan` shows it, but only when the owner runs it.
- **Verify at build:** the state contains neither token nor tunnel secret (`grep`); exact Terraform token permission names; how Cilium matches egress to the Gateway's Envoy (likely `toEntities: ingress`, not a pod selector); whether `cloudflared` with a token needs `api.cloudflare.com:443`; the catch-all returns `404` for an unrouted name in the zone; after `rebuild-cluster.ps1` the tunnel is healthy with no Cloudflare change; one `terraform import` rehearsed from an empty state; one token rotation walked; level 2 of the brake flipped on and off through the variable.
- **Verified at build, 2026-11-17** ([Cloudflare edge as Terraform](https://github.com/bhh1893/health-tracker/issues/188)): the state holds no tunnel secret and no token; the permission names above; `plan` shows no changes after `apply`; level 2 of the brake flipped on (`/oauth2/start` got `403`, other paths did not) and off; re-adoption rehearsed from an empty state, through `import` blocks (`iac/cloudflare/import.tf.example`) rather than one `terraform import` per resource, because the DNS record and ruleset IDs are not shown in the dashboard. The other items wait for `cloudflared` ([#189](https://github.com/bhh1893/health-tracker/issues/189)).
