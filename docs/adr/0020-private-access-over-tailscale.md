---
status: accepted
---

# Private access over Tailscale at `health.nibblejiggle.xyz`, HTTPS on the Gateway, no LAN path

The app is reachable only from devices on the owner's tailnet, at home and away, through one name: `https://health.nibblejiggle.xyz`. The Tailscale Kubernetes Operator publishes the Cilium Gateway as a Tailscale Service with a stable tailnet IP; public DNS on Cloudflare points the name at that IP; cert-manager gets the certificate by DNS-01. The home LAN path (`192.168.0.250`, bridged NIC, L2 announcement) is removed. This amends ADR 0010 (edge), ADR 0015 (secrets) and ADR 0019 (node firewall) ([Private access and domain design](https://github.com/bhh1893/health-tracker/issues/122)).

## Shape

- **Path:** phone (Tailscale on) -> split DNS -> TailVIP -> Tailscale ingress ProxyGroup pod -> Cilium Gateway (TLS terminates here) -> `HTTPRoute`s -> services. No Tailscale code in `api` or `web`.
- **Exposure:** Tailscale Kubernetes Operator (Helm, `k8s/platform`) with an ingress ProxyGroup. The Gateway carries `tailscale.com/expose` and `tailscale.com/proxy-group` under `spec.infrastructure.annotations`, so Cilium copies them onto the Service it generates. The operator creates Tailscale Service `svc:health`, whose TailVIP survives rebuilds: a new operator adopts the existing Service. Cilium needs `socketLB.hostNamespaceOnly: true` and an explicit `devices` list (not `tailscale0`). Tailscale Services are on the free Personal plan (GA Feb 2026, 10 per account).
- **Domain and DNS:** Porkbun stays the registrar; DNS hosting moves to a free Cloudflare account (DNSSEC off at Porkbun, change nameservers, re-enable DNSSEC through Cloudflare). `health` is a DNS-only (grey cloud) A record to the TailVIP. The apex stays free.
- **Split DNS:** the tailnet sends `nibblejiggle.xyz` queries to `1.1.1.1`, because home routers and some resolvers drop answers in `100.64.0.0/10` as DNS rebinding.
- **Certificates:** cert-manager `config.gatewayAPI.enabled: true` (Gateway API CRDs installed first), a Cloudflare DNS-01 `ClusterIssuer` with a token scoped to the one zone, the `cert-manager.io/cluster-issuer` annotation on the Gateway, HTTPS listener `:443` with `hostname`, `tls.mode: Terminate`, Secret in `edge`. Staging issuer while building, production after. After first issuance the TLS Secret is saved to the dev VM and restored by `apply-secrets` before the Gateway, so rebuilds do not re-issue (Let's Encrypt: 5 certificates per name per 7 days).
- **Ports:** `:443` serves the app; `:80` only redirects to HTTPS. No HSTS yet (ADR 0010 reasoning).
- **Tailnet policy as code:** `iac/tailscale/policy.hujson`, applied on merge to `main` by Tailscale's `gitops-acl` GitHub Action. Default allow-all replaced: `autogroup:member` reaches `svc:health` on `tcp:443` and `tcp:80` only; owner devices keep broad access; `tag:k8s-operator` owns `tag:k8s`; `autoApprovers.services` admits `tag:k8s` hosts. Device approval on.
- **Admitting people:** invite them as tailnet users (free plan: 6 users including the owner). Node sharing cannot work: tagged devices cannot be shared. Tailnet admission is not app admission; the app's Pending Role still applies.
- **Secrets (amends ADR 0015):** operator OAuth client (Services, Devices Core, Auth Keys write scopes) and the Cloudflare API token, created in each vendor's console, stored in `~/.config/health-tracker/` on the dev VM, applied by `apply-secrets`. The `gitops-acl` credential is a GitHub Actions secret. Rotate on suspicion.
- **No LAN path (amends ADR 0010, 0019):** the bridged NIC on the workers, the L2 LoadBalancer pool and the bridged-NIC firewall rules are removed. Nothing in the cluster is reachable from the home LAN. The host-only network for cluster and dev VM traffic is unchanged.
- **Rebuilds:** each one leaves an offline operator device and proxy devices behind. They break nothing, but they count toward the plan's 50 tagged resources (about 3 per rebuild), so the rebuild runbook gets a manual "remove offline `tag:k8s` devices" step; automate through the Tailscale API if rebuilds become frequent.

## Considered Options

- **Subnet router advertising `192.168.0.250/32`.** Rejected: simpler, but `192.168.0.0/24` is the most common home range, and on a foreign Wi-Fi in that range iOS can prefer the LAN route, breaking the app away from home. A `100.x` TailVIP never clashes.
- **Operator L7 Ingress or `tailscale serve` with `*.ts.net` certificates.** Rejected: TLS would terminate in a Tailscale proxy instead of the Gateway, the origin would be tied to Tailscale (portability constraint), and it hides the domain/DNS/cert flow this project exists to teach.
- **Porkbun DNS with a cert-manager webhook.** Rejected: no built-in solver; the community webhooks are unmaintained since 2024, so renewal could silently break.
- **Keep the LAN path beside the tailnet.** Rejected: two addresses for one name complicates DNS and certificates, and it keeps LAN-to-pod reachability. Cost accepted: if Tailscale's coordination service is down, a device that is not already connected cannot reach the app even at home.
- **Public internet exposure.** Out of scope for this effort: device-only access removes the sign-up abuse surface (map: Health Tracker v1: private access and sign-in).
- **Policy edited in the admin console.** Rejected: no history, drifts from the repo.

## Consequences

- A third party is in the access path: Tailscale's coordination server. Established connections survive its outage; new devices and fresh rebuilds wait for it.
- Revoking a person is two independent steps: remove them (or their device) from the tailnet, and demote their Role in the app.
- The browser origin `https://health.nibblejiggle.xyz` is a secure context: `crypto.randomUUID`, service workers and passkeys become available (ADR 0010 client note no longer binds).
- The hostname appears in public Certificate Transparency logs; it resolves publicly to an address only tailnet members can reach.
- **Verify at build:** Cilium propagates `spec.infrastructure.annotations` to the Gateway Service; in-cluster traffic to the Gateway ClusterIP still reaches Envoy with the socket LB change; `tailscale ping` from the phone shows a direct path or an acceptable DERP relay; certificate restore on rebuild issues no new certificate.
