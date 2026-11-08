# Research: own domain and HTTPS on a tailnet IP

Ticket: [#120](https://github.com/bhh1893/health-tracker/issues/120), map [#117](https://github.com/bhh1893/health-tracker/issues/117). Checked 2026-11-07. Baseline: ADR 0010 "v2 starting point: HTTPS".

## Recommendation

- Keep Porkbun as **registrar**, move **DNS hosting** to a free Cloudflare account (change nameservers at Porkbun). Use cert-manager's built-in Cloudflare DNS-01 solver with a zone-scoped API token.
- Publish `health.<domain>` as a **DNS-only (grey cloud)** A record to the tailnet IP chosen in #119/#122.
- Add a Tailscale **split DNS** entry: `<domain>` resolved by `1.1.1.1`, so phones on the tailnet never depend on the local Wi-Fi or carrier resolver accepting a 100.x answer.
- Production `ClusterIssuer` by default, staging issuer while iterating. **Back up the issued TLS Secret** to the dev VM and restore it on rebuild (same pattern as ADR 0011/0015), so rebuilds do not re-issue.
- Do not use `*.ts.net` certificates for the app URL: they skip the Gateway and tie the app's origin to Tailscale.

The key fact that makes all of this work: **DNS-01 never connects to the IP in the A record.** Let's Encrypt only checks a TXT record at `_acme-challenge.health.<domain>`, so a certificate for a name that points at a private 100.x address is issued exactly like any other ([cert-manager DNS-01](https://cert-manager.io/docs/configuration/acme/dns01/)).

## 1. DNS host: Porkbun DNS vs Cloudflare

### Porkbun DNS + third-party webhook

- cert-manager has 8 built-in DNS-01 providers (ACMEDNS, Akamai, AzureDNS, Cloudflare, Google, Route53, DigitalOcean, RFC2136). Porkbun is not one of them and is not in the list of 34 known third-party webhooks ([cert-manager DNS-01](https://cert-manager.io/docs/configuration/acme/dns01/)).
- Porkbun webhooks on GitHub (checked via the GitHub API):

  | Repo | Last push | Last release | Stars |
  | --- | --- | --- | --- |
  | [mdonoughe/porkbun-webhook](https://github.com/mdonoughe/porkbun-webhook) | 2024-10-11 | `porkbun-webhook-0.1.5`, 2024-10 | 45 |
  | [Talinx/cert-manager-webhook-porkbun](https://github.com/Talinx/cert-manager-webhook-porkbun) | 2024-10-17 | `1.0.0`, 2024-10 | 1 |
  | [robertoeguia/certmgr-porkbun-webhook](https://github.com/robertoeguia/certmgr-porkbun-webhook) | 2025-02-19 | none | 0 |
  | [oursland/porkbun-webhook](https://github.com/oursland/porkbun-webhook) (fork) | 2025-07-24 | none | 0 |

  The most used one builds against `cert-manager v1.16.1` (repo is at `v1.21.3`), installs from a local chart path (no Helm repo), has 3 open issues/PRs from 2023-2025 with no response, and is a one-person, unofficial project ([README](https://github.com/mdonoughe/porkbun-webhook)). Its Go client [nrdcg/porkbun](https://github.com/nrdcg/porkbun) is maintained, but the webhook itself is not.
- A webhook is an extra Deployment plus an APIService that the cert-manager controller calls, running with the DNS credential ([webhook docs](https://cert-manager.io/docs/configuration/acme/dns01/webhook/)). That is one more image to pin, patch and trust.
- Porkbun's API itself is fine: keys can be scoped to specific domains, source IP CIDRs and permissions ([API docs](https://porkbun.com/api/json/v3/documentation)), and API access must be switched on per domain (Domain Management > Details > API Access) ([KB: Getting started with the Porkbun API](https://kb.porkbun.com/article/190-getting-started-with-the-porkbun-api)).
- **Setup:** enable API access, create key, deploy webhook chart, Secret, RBAC, issuer. **Operate:** track an unmaintained webhook across cert-manager upgrades; if it breaks, renewal silently stops.

### Cloudflare DNS (registrar stays Porkbun)

- Cloudflare is a built-in solver, maintained in cert-manager itself ([Cloudflare solver](https://cert-manager.io/docs/configuration/acme/dns01/cloudflare/)).
- Credential: an API token with `Zone - DNS - Edit` and `Zone - Zone - Read`, stored in a Secret under key `api-token`. The docs recommend tokens over the global API key (scoped and revocable). The docs example uses all zones; restrict Zone Resources to the one zone.
- Full (primary) DNS setup is available on the Free plan. Steps: add the domain, review imported records, **turn off DNSSEC at the registrar first**, replace Porkbun's nameservers with the two Cloudflare ones, wait up to 24 h for Active, then re-enable DNSSEC through Cloudflare ([Cloudflare full setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)).
- The A record must be **DNS only** (grey cloud). Cloudflare's proxy cannot reach a 100.x origin, and the app is not meant to be public anyway.
- **Setup:** one free account, one nameserver change, one token. **Operate:** nothing beyond rotating the token (ADR 0015 amendment).

**Decision driver:** both cost about the same to set up; Cloudflare removes an unmaintained third-party component from the renewal path. It also matches ADR 0010's v2 starting point. The cost is a second vendor account and a second place DNS lives.

## 2. Publishing a 100.x IP in public DNS

- **Exposure:** anyone can resolve the name, but Tailscale IPs are reachable only by tailnet members, which Tailscale describes as "relatively harmless" ([DNS in Tailscale](https://tailscale.com/docs/reference/dns-in-tailscale)). The hostname also appears in Certificate Transparency logs for any public certificate.
- **Rebinding protection** drops DNS answers that contain private addresses. dnsmasq, which most home routers and OpenWrt use, treats **100.64.0.0/10 as private** in `private_net()` alongside 10/8, 172.16/12 and 192.168/16 ([dnsmasq `rfc1035.c`](https://raw.githubusercontent.com/imp/dnsmasq/master/src/rfc1035.c)). Tailscale confirms some home routers (Google Wi-Fi), ISP and corporate resolvers do this, including for the Tailscale range ([KB 1195](https://tailscale.com/kb/1195/dns-rebinding)).
- The user has no router admin access, so "whitelist the domain on the router" is not available. Tailscale's preferred fix is **split DNS**: in the tailnet DNS settings, send queries for `<domain>` to a resolver you choose; for a domain not hosted internally, a public resolver such as Cloudflare `1.1.1.1` ([KB 1195](https://tailscale.com/kb/1195/dns-rebinding)). The phone then gets the answer through the Tailscale client regardless of home Wi-Fi, gym Wi-Fi or carrier DNS.
- Requires the phone's Tailscale app to accept tailnet DNS settings (on by default). If a device turns that off, it falls back to its local resolver and may hit rebinding protection.
- **Address stability:** a Tailscale IP stays fixed while the node stays registered; it changes if the node is removed, Tailscale is reinstalled, or its state (node key) is wiped ([KB 1033](https://tailscale.com/kb/1033/ip-and-dns-addresses)). A cluster rebuild that recreates the Tailscale node without its state gives a new IP, and the A record goes stale. #119/#122 must either persist that state across rebuilds or reassign the IP (admins can set it via IP pool, same KB). cert-manager does not manage A records, so this is not solved by the certificate flow.

## 3. Let's Encrypt limits vs rebuilds

Current production limits ([rate limits](https://letsencrypt.org/docs/rate-limits/)):

| Limit | Cap | Refill |
| --- | --- | --- |
| New certificates per exact set of identifiers | 5 per 7 days | 1 every 34 h |
| New certificates per registered domain | 50 per 7 days | 1 every 202 min |
| New orders per account | 300 per 3 h | 1 every 36 s |
| Authorization failures per identifier per account | 5 per hour | 1 every 12 min |
| New registrations per IPv4 | 10 per 3 h | 1 every 18 min |

- **ARI renewals are exempt from all limits.** Non-ARI renewals (same identifiers) skip the per-account and per-domain limits but **still count against the 5-per-week exact-set limit**. Revoking does not reset limits.
- A rebuild without a restored Secret is a new order for the same name, so it counts toward the exact-set limit. The 6th rebuild inside 7 days fails, then one slot frees every 34 h. Rebuilds are occasional (ADR 0011), but iterating on the rebuild script or the cert flow can burn 5 in a day.
- **Staging** limits are effectively unlimited for this use (30,000 per week per exact set, 200 auth failures per hour), directory `https://acme-staging-v02.api.letsencrypt.org/directory`, certificates chain to untrusted roots so browsers will warn ([staging](https://letsencrypt.org/docs/staging-environment/)).

**Keeping the certificate across rebuilds:**

- cert-manager re-issues when it finds no Secret with a valid certificate for a `Certificate`; restore Secrets **before** the Certificates or Gateway that reference them, and do not restore `Order`s, `Challenge`s or `CertificateRequest`s ([backup docs](https://cert-manager.io/docs/devops-tips/backup/)).
- The re-issue triggers include `SecretIssuerAnnotationsMismatch` and `SecretCertificateNameAnnotationsMismatch` ([policies.go @ v1.21.3](https://github.com/cert-manager/cert-manager/blob/v1.21.3/internal/controller/certificates/policies/policies.go)), so restore the Secret with its cert-manager annotations intact (`kubectl get secret -o yaml`, strip `uid`/`resourceVersion`), and keep the Certificate name and issuer name stable.
- Proposed shape: after first issuance, save `edge/<tls-secret>` (and optionally the ACME account key Secret) to `~/.config/health-tracker/` on the dev VM, mode 600, next to `backup.env`. `apply-secrets` (ADR 0015) re-applies it before the Gateway. If it is missing or expired, cert-manager simply issues a new one. The TLS private key then lives on the dev VM, the same trust level as the other secrets there.
- Use the staging `ClusterIssuer` while building the flow; switch the Gateway annotation to production once it works end to end.

## 4. Alternative: Tailscale certificates on `*.ts.net`

- Tailscale gets Let's Encrypt certificates via DNS-01 on its own `ts.net` zone for `machine-name.<tailnet-name>.ts.net`. MagicDNS and HTTPS must be enabled in the admin console. Tailnet names are either the default `tailNNNN.ts.net` or a random two-word name; no other names. Certificates appear in public CT logs. Certificates installed with `tailscale cert` are not renewed into place automatically ([KB 1153](https://tailscale.com/kb/1153/enabling-https)). The docs cover only `ts.net` names, no custom domains.
- Pros: no domain, no DNS provider, no rebinding problem (MagicDNS answers inside the client).
- Why the own domain is still wanted:
  - **Learning goal (#117):** registrar, nameservers, records, DNS-01, cert-manager and the Gateway TLS listener are what the user wants to learn; `ts.net` hides all of it.
  - **Gateway stays the edge:** `ts.net` TLS terminates in a Tailscale proxy, not at the Cilium Gateway, which bypasses ADR 0010's design.
  - **Stable origin:** the browser origin is the unit for storage, the home-screen app and OIDC redirect URIs. `health.<domain>` survives replacing Tailscale (v2 portability constraint, CLAUDE.md); a `ts.net` URL does not, and changing it loses on-device data and requires re-registering redirect URIs.

## 5. What cert-manager needs on the Cilium Gateway

Current state on main: cert-manager `v1.21.3` with only `crds.enabled: true` (`k8s/platform/cert-manager/`), Cilium with `gatewayAPI.enabled: true`, one Gateway `edge/edge` with an HTTP `:80` listener (`k8s/platform/edge/gateway.yaml`).

From the [cert-manager Gateway docs](https://cert-manager.io/docs/usage/gateway/):

- **cert-manager values:** `config.gatewayAPI.enabled: true`. The Gateway API CRDs must exist **before** cert-manager starts, or cert-manager must be restarted. Check the Ansible order: Cilium/Gateway CRDs before the cert-manager chart.
- **Gateway annotation:** `cert-manager.io/cluster-issuer: letsencrypt-prod` (or `-staging`).
- **Listener rules** for a Certificate to be generated: `hostname` set, `tls.mode: Terminate`, `tls.certificateRefs[].name` set, kind `Secret`, Secret in the **Gateway's namespace** (`edge`). Cross-namespace refs are skipped.
- **Cilium side:** chart defaults `gatewayAPI.secretsNamespace.sync: true`, `name: cilium-secrets` copy TLS Secrets into Cilium's namespace for Envoy; nothing to change ([Cilium Helm reference](https://docs.cilium.io/en/stable/helm-reference/)).
- **Sketch:**

  ```yaml
  metadata:
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
  spec:
    listeners:
      - name: http            # only serves the redirect route
        protocol: HTTP
        port: 80
      - name: https
        protocol: HTTPS
        port: 443
        hostname: health.<domain>
        tls:
          mode: Terminate
          certificateRefs:
            - name: health-tls
        allowedRoutes: { ...same selector as today... }
  ```

  Plus a `ClusterIssuer` (ACME, Cloudflare `apiTokenSecretRef`, `dnsZones: [<domain>]`), the token Secret in the `cert-manager` namespace (ClusterIssuer secrets resolve there by default), app `HTTPRoute`s bound to the `https` listener via `sectionName`, and an `http` route with a `RequestRedirect` to `https` (ADR 0010).
- **Node firewall (ADR 0019):** admits only `:80` on the bridged NIC today; `:443` must be added on whichever path tailnet traffic arrives (decided in #119/#122).

## Open items for #122 (design)

- Which tailnet IP the A record points to, and how it survives a rebuild (Section 2).
- Where the Cloudflare token lives and how it rotates (ADR 0015 amendment).
- Whether to keep `:80` on the tailnet path at all, or serve only `:443`.
