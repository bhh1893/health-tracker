# Research: passwordless OIDC provider

Ticket: [#121](https://github.com/bhh1893/health-tracker/issues/121), map [#117](https://github.com/bhh1893/health-tracker/issues/117). Researched 2026-11-07 against vendor docs, specs and GitHub. Throwaway branch: findings, not a decision.

## Question

Which identity providers give passwordless sign-in through a standard OIDC flow to a self-hosted, cloud-agnostic app reached only over a tailnet? Constraints from the repo: 4 GB workers (each already carries a 512 Mi Postgres instance, ADR 0005), CNPG on Postgres 18, an auth proxy such as oauth2-proxy replacing the nginx sidecar (ADR 0010), a React SPA used as an iOS home-screen web app (ADR 0007), no provider SDKs in service code.

## Recommendation

**Pocket ID, self-hosted, passkeys as the only sign-in method, database on CNPG, open signup, no email in v1.** Keep the Pending/Member/Admin Role in the `api` database keyed by OIDC `sub`, so the approval command never needs the IdP's admin API.

Why:

- It does exactly what the map needs and nothing else: passkey-only OIDC provider, self-signup, Postgres via one connection string, single process. The heavyweights (Keycloak, Authentik, Zitadel) cost 0.5-2 GB per worker for features v1 does not use.
- Passkeys avoid the iOS home-screen problem with magic links entirely, and avoid SMTP, SPF/DKIM and sign-up email abuse limits (a "Not yet specified" item on the map disappears).
- Open signup is acceptable only because the app is tailnet-only and every sign-up starts Pending. Pocket ID's own docs say the same ([user management](https://pocket-id.org/docs/setup/user-management)).

Costs to accept: no official Helm chart (we write a Deployment, Service and HTTPRoute ourselves, which is small for a single binary), no published sizing (measure it), Postgres 18 not explicitly listed (verify at build), and a lost-device recovery path that is admin-issued, not self-service.

Runner-up: **Zitadel** if a mature official Helm chart and email OTP matter more than footprint. Managed fallback: **Auth0 free**, which works with a tailnet-only host (see below) but adds an external dependency and account.

**Biggest risk, independent of provider:** an OIDC redirect to a different origin inside an iOS home-screen web app may open in a Safari View Controller sheet with its own cookies, so the session cookie could land outside the app. Spike this on the phone before locking the design (see "iOS home-screen web app").

## Comparison

| | Pocket ID | Zitadel | Keycloak | Authentik | Kanidm | Tailscale tsidp | Auth0 (Free) | Clerk (Hobby) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Passkeys | Yes, primary and only method [1] | Yes [5] | Yes, supported since 26.4 [8] | Yes (WebAuthn stage) | Yes, WebAuthn L3 [11] | n/a, identity = tailnet login [12] | Yes [13] | **No on Hobby** [16] |
| Email one-time code | Admin-sent, or user-requested if enabled [2] | Second factor only [5] | Extension only (Phase Two) [9] | Email stage (link) | No (reset links only) [11] | No | Yes, Universal Login [14] | Yes [16] |
| Magic link | No | No | Extension only [9] | Yes | No | No | Classic Login only [14] | Yes [16] |
| Upstream identity | No | Yes (Google, Apple, ...) [5] | Yes | Yes | No | Tailnet identity | Yes | Yes |
| Self-registration | Yes: `open` or `withToken` [2] | Yes, "Register allowed" [5] | Yes | Yes (enrollment flow) | **No**, admin creates accounts [11] | Via tailnet invite only | Yes | Yes |
| Footprint | Single binary, no published figure | ~512 MB plus a Next.js login container [4][6] | 1250 MB request, 1360 MB limit per pod [7] | Min 2 CPU, 2 GB RAM [3] | ~64 KB per entry [11] | Small | none in cluster | none in cluster |
| Postgres / CNPG | Yes, `postgres://` connection string; PG 18 not stated [2] | PG 14-18; PG 18 needs v4.11.0+ [6] | Yes | Required; docs recommend CNPG [3] | **No**, own embedded DB file [11] | No, state dir on disk [12] | n/a | n/a |
| Helm chart | **None official** | Official, `charts.zitadel.com` [6] | Operator, or community charts | Official [3] | None (containers) | None (Docker) [12] | n/a | n/a |
| Admin API | REST, `X-API-KEY` [10] | Yes (gRPC/REST) | Admin REST API | Yes | CLI | Grants in tailnet policy | Management API | Backend API |
| Maturity | 10.2k stars, OpenID Certified [1] | Mature, commercial backing | Most mature | Mature | Mature, niche | **Experimental, pre-1.0** [12] | GA | GA; IdP mode is an "advanced" feature [17] |

Verdicts:

- **Kanidm:** out. No self-registration and no Postgres; a second person cannot sign up themselves.
- **tsidp:** out. Experimental with breaking changes, state on disk outside CNPG backups, and it ties identity to Tailscale, which v2 may replace.
- **Keycloak:** out on footprint (a full worker's spare RAM) and no built-in email code or magic link.
- **Authentik:** out on footprint (2 GB minimum) for features v1 does not use. Note it dropped Redis in 2025.10, so it now needs Postgres only [3b].
- **Clerk:** out. No passkeys on the free plan, and its strength is front-end SDKs, which the oauth2-proxy design does not use.
- **Zitadel:** viable, heavier (two containers, h2c to the backend, which the Cilium Gateway must support [6]).
- **Auth0:** viable managed option; see "Managed IdP and tailnet-only redirects".

## iOS home-screen web app

**Email code beats magic link.** Apple: Home Screen web apps on iOS have "separate cookies and storage from the browser", and links outside the app open elsewhere [18]. WebKit calls this isolation "by design" [19]. A link tapped in Mail opens in Safari, not in the home-screen app, so a magic link signs in Safari and the app stays signed out. oauth2-proxy's CSRF/state cookie was also set in the app's cookie jar, so the callback in Safari would fail. A one-time code is typed into the page that started the flow, so it stays in the right context.

**Cross-origin OIDC redirect inside the app (open risk).** Apple, WWDC23: "In Home Screen web apps on iOS, links outside the scope will open in Safari View Controller", but also "Authentication through OAuth on a third-party domain will still open in your web app. This is done through heuristics", and "Links loaded through window.open will always open in the web app regardless of scope" [18]. Community reports disagree on whether the heuristic fires [20]. If the IdP page opens in the sheet and the callback to `health.<domain>` completes there, the session cookie lands in the sheet's storage. This applies to every provider, self-hosted or managed. Mitigations, in order: test the plain redirect on the phone; start sign-in with `window.open`; serve the IdP under the same origin if the provider supports a sub-path (not verified for Pocket ID).

**Passkeys on a private domain.** WebAuthn needs a secure context (HTTPS) [21] and an RP ID equal to, or a registrable suffix of, the page's domain [22]. Nothing requires the host to be publicly reachable: a real domain such as `auth.<domain>` with a publicly trusted certificate (DNS-01) resolving to a tailnet IP works. Do not rename the IdP host later: passkeys are bound to the RP ID (Kanidm's docs warn a domain rename "WILL break ALL PassKeys" [11]; the same holds for any provider). Tailscale's own `*.ts.net` HTTPS is an alternative, but machine names land in public Certificate Transparency logs [23]. Passkeys inside a standalone home-screen app were not confirmed by a primary source; verify on the device in the same spike.

## Email, only if needed

Not needed with passkeys-only. If email codes are wanted later (recovery, or a user without a passkey device):

- **Provider:** any SMTP relay works with Pocket ID, Zitadel and the others, so no provider SDK. Resend free: 3,000/month, 100/day, SMTP relay included [24]. Zitadel's docs list SES, Mailgun, Mailjet and SendGrid as SMTP templates [25].
- **DNS on Porkbun:** Gmail requires every sender to have SPF or DKIM, valid PTR, and TLS; bulk senders (over 5,000/day) need SPF, DKIM and DMARC [26]. The relay provides PTR and TLS; we add its SPF and DKIM TXT records, and a DMARC record is cheap and worth adding anyway.
- **Abuse:** with open signup and user-requested codes enabled, anyone on the tailnet can trigger mail. Pocket ID warns that user-requested codes mean "anyone with access to their email can then sign in as them" [2]. Keep `EMAIL_ONE_TIME_ACCESS_AS_UNAUTHENTICATED_ENABLED` off in v1.

## Managed IdP and tailnet-only redirects

Yes, it works. In the authorization code flow the IdP sends the user back through the browser (a front-channel redirect) [27], so the IdP never connects to `health.<domain>`. The only network path it needs is the reverse: oauth2-proxy in the cluster calls the IdP's token and JWKS endpoints outbound over the internet. Auth0 only warns against `localhost` callbacks in production [15]. Free Auth0: 25,000 MAU, passwordless and passkeys included [13]. Cost: an internet dependency for every sign-in, a vendor account, and user data outside the backups.

## Answers to the ticket bullets

- **Candidates:** see the table. Pocket ID fits best; Zitadel second; Auth0 the managed option.
- **Email code vs magic link on iOS:** code. A magic link opens in Safari, whose cookies are separate from the home-screen app.
- **Passkeys over HTTPS on a private domain:** yes, with a real domain and a public CA certificate; reachability does not matter. Keep the RP ID host stable.
- **Email-sending options:** not needed for passkeys-only. If needed, an SMTP relay free tier (Resend) plus SPF/DKIM/DMARC TXT records on Porkbun.
- **Managed IdP to a tailnet-only host:** yes; redirects go through the browser, and only outbound calls from the cluster are needed.

## Open questions for the design ticket (#123)

1. Does the cross-origin OIDC redirect stay inside the iOS home-screen app? Spike on the phone with any OIDC provider before choosing.
2. Pocket ID on Postgres 18 and its real memory use under CNPG: measure in the spike.
3. Lost-passkey recovery: admin-issued login code from the dev VM (Pocket ID REST API with an API key) vs enabling email codes.
4. IdP backups: Pocket ID's data lives in its own CNPG database, so it rides the existing backup and restore path (ADR 0011). Signing keys must be included or restored, or all sessions break after a rebuild.

## Sources

1. Pocket ID README: https://github.com/pocket-id/pocket-id and docs: https://pocket-id.org/docs/
2. Pocket ID env vars (`DB_CONNECTION_STRING`, `ALLOW_USER_SIGNUPS`, `EMAIL_ONE_TIME_ACCESS_*`): https://pocket-id.org/docs/configuration/environment-variables ; user management: https://pocket-id.org/docs/setup/user-management
3. Authentik Kubernetes install: https://docs.goauthentik.io/install-config/install/kubernetes/ ; requirements: https://docs.goauthentik.io/install-config/install/docker-compose/ ; [3b] 2025.10 release notes: https://docs.goauthentik.io/releases/2025.10/
4. Zitadel production sizing: https://zitadel.com/docs/self-hosting/manage/production
5. Zitadel login settings: https://zitadel.com/docs/guides/manage/console/default-settings
6. Zitadel Kubernetes deploy: https://zitadel.com/docs/self-hosting/deploy/kubernetes
7. Keycloak memory and CPU sizing: https://www.keycloak.org/high-availability/multi-cluster/concepts-memory-and-cpu-sizing
8. Keycloak 26.4 release notes: https://www.keycloak.org/docs/26.4.7/release_notes/
9. Phase Two magic link extension: https://github.com/p2-inc/keycloak-magic-link
10. Pocket ID REST API: https://pocket-id.org/docs/api
11. Kanidm book: https://kanidm.github.io/kanidm/stable/print.html
12. tsidp README: https://github.com/tailscale/tsidp
13. Auth0 pricing: https://auth0.com/pricing
14. Auth0 passwordless: https://auth0.com/docs/authenticate/passwordless
15. Auth0 application settings: https://auth0.com/docs/get-started/applications/application-settings
16. Clerk pricing: https://clerk.com/pricing
17. Clerk as an IdP: https://clerk.com/docs/advanced-usage/clerk-idp
18. Apple WWDC23 "What's new in web apps": https://developer.apple.com/videos/play/wwdc2023/10120/
19. WebKit bug 181849: https://bugs.webkit.org/show_bug.cgi?id=181849
20. Community reports on OAuth in iOS web apps: https://github.com/nolanlawson/pinafore/issues/45 , https://progressivewebapps.com/platforms/ios-safari
21. MDN Web Authentication API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API
22. W3C WebAuthn Level 3, Relying Party Identifier: https://www.w3.org/TR/webauthn-3/#relying-party-identifier
23. Tailscale HTTPS certificates: https://tailscale.com/kb/1153/enabling-https
24. Resend pricing: https://resend.com/pricing
25. Zitadel notification providers: https://zitadel.com/docs/guides/manage/customize/notification-providers
26. Google email sender guidelines: https://support.google.com/a/answer/81126
27. RFC 6749 section 4.1, authorization code grant: https://datatracker.ietf.org/doc/html/rfc6749#section-4.1
