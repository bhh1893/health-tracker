---
status: accepted
---

# Auth at the edge: Google sign-in through an oauth2-proxy sidecar in each pod, identity to `api` by trusted header

Nothing is served without a session, not even the `web` bundle. oauth2-proxy replaces the nginx sidecar from ADR 0010 and is added to the `web` pod as well. Both copies share one session cookie and run the server-side OIDC code flow with Google. `api` and `web`'s nginx still listen only on `127.0.0.1`, so the proxy is the only way in. `api` learns who is calling from headers the proxy sets, and Pending is turned into `403` inside `api`. Decided in [Identity provider and sign-in flow](https://github.com/bhh1893/health-tracker/issues/123) (the flow) and [Auth enforcement at the edge](https://github.com/bhh1893/health-tracker/issues/124) (the enforcement). This amends ADR 0006, ADR 0010 and ADR 0015.

## Shape

### The sign-in flow

- **No session means one Sign-in page.** Every URL without a session gets a small static page with a single "Sign in with Google" button, then returns to the page originally asked for. The same page appears on first visit, after expiry and after sign-out. Sign-out (`/oauth2/sign_out`) clears the cookie only; it does not sign the person out of Google.
- **Server-side authorization code flow.** The proxy handles the redirect to Google and swaps the code for tokens using the client secret. Callback: `https://health.nibblejiggle.xyz/oauth2/callback`. Scopes: `openid email profile` only. `web` never sees a token; the enter-secret screen and its `localStorage` handling are deleted.
- **Sign-up and the Pending screen.** A person's first sign-in creates their User as Pending. `GET /api/me` returns `{ role, name }` and is the only endpoint Pending may call. `web` shows "Waiting for approval" with "Check again" and "Sign out". No polling, no notifications.
- **Expiry.** When `web` gets a `401` it does a full-page reload into sign-in, returning to the same path. Unsaved form input is lost. That is accepted, on condition that the session lifetime (decided in Session lifetime on the phone) makes expiry rare in daily use.
- **The owner claims the seeded User.** The owner signs in, is Pending once, then runs the `claim-seeded` mode of the approval command on the dev VM. In one transaction it writes the owner's identity onto `019a0000-0000-7000-8000-000000000001` as Admin and deletes the empty Pending User.
- **Google Cloud setup is a manual runbook.** Google has no API or Terraform resource for a regular web OAuth client. Project `health-tracker`; consent screen External, **In production**; Web application client; one redirect URI; no JavaScript origins.
- **Who may sign in:** any Google account (`--email-domain=*`). The gates are the tailnet (ADR 0020) and then Approval. An email allowlist would be a third, hand-kept list repeating Approval.

### Enforcement

- **Proxy:** oauth2-proxy with the generic `oidc` provider pointed at Google's issuer, not its `google` provider. The generic provider is plain OIDC, so changing providers is a config change.
- **A sidecar in each pod.** oauth2-proxy runs as a native sidecar in the `api` pod and in the `web` pod. Both use the same cookie name and secret, so one sign-in covers both.
  - `api` pod: `--api-route=^/api/`, so a request without a session gets `401`, not a redirect.
  - `web` pod: serves the Sign-in page and `/oauth2/*`. `/oauth2/callback` falls into `web`'s existing `/` route.
  - The `HTTPRoute`s do not change.
- **Localhost is the trust boundary.** uvicorn and `web`'s nginx bind `127.0.0.1`. A mistake there fails the probes, so the pod never goes ready: it fails closed, which is the property ADR 0010 chose a sidecar for.
- **Probes:** the proxy passes `/healthz` and `/readyz` through without auth (`--skip-auth-route`), replacing nginx's separate health port. Other pods can already reach these paths, and they only report health status (ADR 0010).
- **Shared config:** one Kustomize component, `k8s/components/auth-proxy/`, holds the container spec, the shared settings and the Sign-in page template. Both services include it and set only their own differences. This is platform config, not service code, so ADR 0003's "share only the contract" rule still holds. Two hand-kept copies would drift, and a cookie setting that differs between them breaks the shared session.

### Identity into `api`

- **Trusted headers.** The proxy sets headers carrying the issuer, `sub` and `name` (oauth2-proxy alpha config `injectRequestHeaders`) and overwrites any copies the client sent. No token reaches `api`.
- **Key:** Users are keyed by `(issuer, sub)`. `sub` is unique only within one provider, and this design has already changed provider once.
- **`current_user` dependency** runs on every request:
  - Identity headers missing: `401`. There is no fallback to the seeded User. In production `api` cannot be reached without the proxy, so this only fires if a later change opens another way in.
  - Unknown `(issuer, sub)`: insert a Pending User with `INSERT ... ON CONFLICT DO NOTHING`, so two simultaneous first requests are safe. This insert is Sign-up.
  - Pending, on any route but `GET /api/me`: `403` Problem, type `urn:health-tracker:problem:pending-approval`.
  - Otherwise: the User's internal UUID. Every existing query stays scoped exactly as before (ADR 0002).
- The table shape, Roles and the approval command are decided in [Users, Roles and the approval command](https://github.com/bhh1893/health-tracker/issues/125).

### Session

- **Stored in the cookie**, encrypted with the cookie secret (oauth2-proxy's default). There is no server-side state to run, back up or restore. A large Google ID token can push it past 4 KB, in which case oauth2-proxy splits it across several cookies.
- **Cookie:** `__Host-health_session`, `HttpOnly`, `Secure`, `SameSite=Lax`. The `__Host-` prefix makes the browser enforce `Secure`, `Path=/` and no `Domain` attribute.
- **CSRF:** `SameSite=Lax` keeps the cookie off cross-site `PUT`/`DELETE`, and `api` sends no CORS headers, so other origins cannot make credentialed writes.
- Lifetime and refresh are decided in Session lifetime on the phone.

## Considered Options

- **One central `auth-proxy` Deployment that the Gateway sends everything to.** The more common setup, with one proxy instead of two. Rejected: `api` would have to listen on its pod IP, so the trust boundary would be either a NetworkPolicy (fails open on a mistake, as ADR 0010 found) or `api` verifying the token itself.
- **`api` verifies the ID token (JWT against Google's JWKS).** Rejected: it defends against a misconfigured proxy, but it adds auth code, key fetching and token-refresh concerns to `api`. Localhost binding already gives that protection.
- **Gateway external auth (Gateway API `ExternalAuth` filter, Envoy `ext_authz`).** What a larger company would use. Rejected: not implemented by Cilium's Gateway API support as far as we know, and the hand-written `CiliumEnvoyConfig` route was rejected in ADR 0010.
- **oauth2-proxy's `google` provider.** Rejected: Workspace group features we don't use, and it ties the config to Google.
- **Redis session store.** Rejected: allows revoking one session on the server, but adds a stateful service. Removing a person's Role in `api` already stops them reaching data.
- **Problem Details body on the proxy's `401`.** Rejected: needs a custom error template scoped to the API route, and clients branch on the status code anyway (ADR 0006).
- **Auto-redirect to Google with no Sign-in page.** Rejected: sign-out would still need its own page to stop an instant re-sign-in, so that is two rules where one does.
- **The SPA runs the flow and holds tokens.** Rejected: any injected script could steal them, and Google web clients need the secret on the server anyway.
- **`OWNER_EMAIL` setting or first-sign-in-wins for the seeded User.** Rejected: the first puts an email in a public repo's config and adds a code path that runs once; the second hands the owner's history to whoever signs in first.
- **Consent screen in Testing mode.** Rejected: a hand-kept allowlist that repeats Approval.

## Consequences

- **Amends ADR 0006:** `401` now comes from oauth2-proxy as a plain response, not `application/problem+json`, and without `WWW-Authenticate: Bearer`. `403` with type `pending-approval` is added. Identity is still implicit ("/me"), now resolved from proxy headers instead of the seeded User.
- **Amends ADR 0010:** the nginx sidecar, its token check and its health port are gone. `web` gets a sidecar too and binds `127.0.0.1`. ADR 0010's planned swap happens with no `HTTPRoute` changes.
- **Amends ADR 0015:** `api-token` and `show-token` are retired. The Google client secret and the cookie secret replace them; where they are generated and stored is decided in a follow-up ticket.
- Every pod carries a second container; two proxies use more memory than one. Accepted.
- A stolen cookie works until it expires. Rotating the cookie secret signs out every User at once.
- How integration tests, Schemathesis and the smoke Job present an identity is decided in a follow-up ticket. Tests that skip the proxy must set the headers themselves.
- **Verify at build:** client-sent identity headers are overwritten, not passed through; the `name` claim reaches `api` as a header; both sidecars accept one session; `/oauth2/callback` reaches the `web` sidecar; the `api` sidecar answers `/api/*` with `401`, never a redirect; probes pass with both backends on `127.0.0.1`.
