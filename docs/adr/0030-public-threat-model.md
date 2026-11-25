---
status: accepted
---

# Public threat model: anyone can reach the Sign-in page, accounts and sessions are the real perimeter

ADR 0015's threat model assumed a private network: only the owner could reach the app, so a cleartext token on home Wi-Fi and no session revocation were fine. ADR 0025 made the app public. This ADR lists what is protected, who it is protected from, and for each risk whether it is mitigated, accepted or out of scope. It replaces ADR 0015's threat model section and checks ADR 0019. Decided in [Public threat model](https://github.com/bhh1893/health-tracker/issues/179).

STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) was used as a completeness check, not as a format.

## Assets

- **Data:** each Member's Meal and Exercise Entries, plus the name and email of everyone who has signed in, strangers included (ADR 0026). Classed as **personal data, low sensitivity**: health-adjacent, not medical records. The owner holds other people's data now, so a leak is a breach of their trust, not only the owner's privacy. That justifies the controls already decided; it does not justify encryption at rest or an audit log.
- **Credentials that grant the app:** the cookie secret (forges any session), session cookies, the Google client secret, the tunnel token (receives live traffic), the Terraform token, the DNS-01 token, the database role passwords. Inventory in ADR 0015 and ADR 0029.
- **Availability:** the owner logging every day from the phone.

## Who we defend against

| Attacker | Status | Main controls |
| --- | --- | --- |
| Anonymous internet: scanners and bots, which read the hostname from Certificate Transparency logs | In scope | No data served without a session, only the Sign-in page, health status, and the icons and web manifest since 2026-11-25 (ADR 0021, unauthenticated surface in ADR 0025); `/oauth2/` rate rule and DDoS at Cloudflare (ADR 0027); patching deadlines (ADR 0028) |
| A signed-in stranger (Pending, valid session) | In scope | Pending reaches only `GET /api/me`; route-walk test (ADR 0014); Sign-up brake (ADR 0026) |
| A stolen session or a compromised Member | In scope | Two-Member isolation test (ADR 0014); per-User rate and write limits (ADR 0027); access lines (below); incident runbook (below) |
| A compromised dependency or image | In scope | Dependabot, release-watch, digest pins, no automerge (ADR 0028) |
| Claude on the dev VM, by accident | In scope | Read guardrail on `~/.config/health-tracker/` (ADR 0015) |
| Cloudflare, Google, GitHub, Porkbun | Trusted, not adversaries | Their accounts are protected instead (below) |
| Physical or OS access to the Windows PC or VM disks | Out of scope (unchanged from ADR 0015) | They already own everything, backups included |
| Anyone on the home LAN | Out of scope once the LAN path is removed (ADR 0025) | Nothing in the cluster is reachable from the LAN |
| A targeted, well-funded attacker | Out of scope | Not worth the machinery for this data |

## Decisions

### Cloudflare reads plaintext: accepted

Browser TLS ends at Cloudflare (ADR 0025), so it sees URLs, the session cookie, the OIDC callback `code` and every logged Entry. Free Cloudflare Tunnel has no option that avoids this. Accepted: Cloudflare joins Google as a trusted party.

### Path-owning accounts are the perimeter

Whoever controls one of these accounts controls the app, with no attack on the cluster needed:

| Account | What it can do |
| --- | --- |
| Cloudflare | Point `health` anywhere, read every request, change the tunnel |
| Porkbun | Move the nameservers away from Cloudflare |
| Google Cloud (OAuth client project) | Change the redirect URI, rotate or read the client |
| GitHub | Push an image or manifest that Argo CD deploys |

Each needs a passkey or app-based 2FA, never SMS. A build ticket checks all four and records the result. This is the cheapest control in this ADR and covers the highest-impact risk.

**Verified at build, 2026-11-17** ([#196](https://github.com/bhh1893/health-tracker/issues/196)):

| Account | Second factor | SMS | Recovery codes |
| --- | --- | --- | --- |
| Cloudflare | None of its own: Sign in with Google only, no password set, so it inherits Google's | Not offered | None issued |
| Porkbun | Authenticator app | Off | Offline |
| Google Cloud | Passkey and authenticator app | Removed as a method and as the recovery phone | Offline |
| GitHub | Authenticator app | Removed, fallback number included | Offline |

All four send password resets to that same Google account, so its inbox is covered by its own row. Cloudflare could likely gain a password through "forgot password" from that inbox, so it is exactly as safe as the Google account. Adding a passkey to GitHub, the account that can deploy code, would make it phishing-resistant; not required.

### Tunnel token theft: rotate, and look at connectors monthly

Anyone holding the tunnel token can run their own connector, and Cloudflare sends them a share of real requests, cookies included. Nothing in the cluster would notice. Rotation steps are in ADR 0029. Added here:

- The monthly sweep (ADR 0028) includes one look at the tunnel's connectors: exactly two, both from the home IP. Anything else triggers rotation.
- **Verify at build:** after a rotation, a connector still running the old token is disconnected and cannot reconnect.
- **Verified at build, 2026-11-17** ([#189](https://github.com/bhh1893/health-tracker/issues/189)): after rotating, a fresh `cloudflared` on the old token reaches Cloudflare's edge but every registration fails with `Unauthorized: Invalid tunnel secret`, so a stolen token is useless once rotated. Not tested: the `DELETE .../connections` step cutting off a connector already running on the old token. That rests on Cloudflare's documentation (ADR 0029); the first real rotation should watch for it.
- No automated alert in v1.

### ADR 0015 and ADR 0010 risks, walked

| Risk accepted on a private network | Now |
| --- | --- |
| Bearer token in cleartext on home Wi-Fi (ADR 0010) | **Resolved:** HTTPS end to end, token retired (ADR 0021), LAN path removed (ADR 0025) |
| Access to the PC or VM disks | **Still out of scope** |
| No etcd encryption at rest | **Still accepted:** reaching etcd still takes the out-of-scope access |
| Rotation only on suspected exposure | **Still accepted:** a leaked cookie secret now works from anywhere, but a schedule still matches no threat in scope |
| No server-side session revocation (Redis rejected, ADR 0021) | **Accepted:** a stolen cookie works from anywhere for up to 30 days. Response, in the incident runbook: remove the User's Role (stops data access at once), or rotate the cookie secret (signs everyone out) |
| Claude guardrail, not a boundary; separate Linux user deferred | **Still deferred to v2:** Claude never handles the Cloudflare or Google values |

### Node firewall (ADR 0019): no further change

After the LAN path goes, the nodes have only the host-only network (`192.168.56.0/24`, reachable from the Windows PC alone) and outbound connections. The tunnel only dials out. `nodePort.addresses` stays. ADR 0019's existing amendment is enough.

### Request attribution

`api`'s current access line shows `127.0.0.1` (the sidecar) and no User, so after a suspected stolen session nobody can tell who did what. `api` writes one structured line per request with:

- User id (or none for probes),
- method,
- **path template** (`/api/v1/meals/{id}`, never the filled-in path, so no values leak into logs),
- status,
- `CF-Connecting-IP`.

Passing probes stay filtered out. Retention is whatever kubelet log rotation keeps, hours to days. Accepted for v1. **A central log store, Loki, is planned for v2**; until then nothing outlives a pod's rotated log files.

### Write limit and public probe

- **A Member filling the database** is mitigated by a separate write limit, 60 per minute per User per pod (amends ADR 0027). At the shared limit, about 600 writes a minute could fill the 5Gi volume in days, and Postgres out of disk stops every User.
- **The public path is probed daily** by a scheduled workflow (amends ADR 0014). The reason it was ruled out, Bot Fight Mode, went away in ADR 0027.

### Incident runbook

`docs/runbooks/incident.md`, written at build, indexes by scenario. Each entry gives the first move and links to the runbook that holds the steps, without copying them:

| Scenario | First move | Steps in |
| --- | --- | --- |
| Stolen session | Remove the User's Role | ADR 0022 `users` command |
| Leaked cookie secret | Rotate it (signs everyone out) | `secrets.md` |
| Leaked tunnel token | Rotate it, drop old connections | `secrets.md` |
| Sign-up flood | Brake level 1, then level 2 | ADR 0026 runbook |
| Traffic flood | "Under Attack" mode | `cloudflare.md` |
| Path-owning account compromised | Recover the account, then rotate everything it could reach | Provider's recovery, then `secrets.md` |

### When to revisit

Update this ADR in the same PR as any change that adds:

- a new way in (hostname, tunnel rule, unauthenticated route),
- a new service or datastore,
- a new trusted third party,
- a new kind of data,

and after any security incident. No review on a calendar.

## Considered Options

- **Expanding ADR 0015's section.** Rejected: ADR 0015 is about secrets; this model spans the edge, auth, the app and the accounts.
- **A living document under `docs/security/`.** Rejected: common at larger companies, but every other decision here lives in ADRs, and the revisit triggers keep this one current.
- **End-to-end TLS past Cloudflare.** Rejected: free Cloudflare Tunnel always terminates HTTP traffic at the edge; avoiding that needs a paid product or a different way in (ADR 0025).
- **Scheduled secret rotation.** Rejected, as in ADR 0015.
- **Shipping logs to Loki now.** Deferred to v2: another stateful service to run and back up, for one owner reading logs rarely.
- **A row quota per User.** Rejected: a write limit bounds the fill rate with one env var; a quota needs counting in the database and a new Problem type.
- **Alerting on tunnel connectors.** Rejected for v1: no metrics or alerting stack exists; the monthly look is the proportionate check.

## Consequences

- **Amends ADR 0015:** its threat model section is replaced by this ADR.
- **Amends ADR 0014:** daily public-surface probe.
- **Amends ADR 0027:** separate write limit.
- **Amends ADR 0028:** the monthly sweep checks tunnel connectors.
- **Build tickets:** 2FA check on the four accounts; access lines in `api`; the probe workflow; the write limit; `docs/runbooks/incident.md`; the connector item in `patching.md`; the rotation check above.
- The access lines and the probe are the only new detection. A compromise that does nothing loud is still unlikely to be noticed in v1.
