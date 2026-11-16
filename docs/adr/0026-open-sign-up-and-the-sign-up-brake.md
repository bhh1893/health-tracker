---
status: accepted
---

# Open Sign-up gated only by Approval, with a Sign-up brake held in the database

Any Google account can sign up and become a Pending User; nothing limits that beyond Approval. The Admin can close Sign-up instantly with `users signup close`, a setting stored in Postgres, so it needs no deploy and Argo CD cannot undo it. Decided in [Sign-up abuse controls](https://github.com/bhh1893/health-tracker/issues/174). This amends ADR 0021 ("Who may sign in") and ADR 0022 (the command and its tables), and follows from ADR 0025 (the app is public).

## Shape

### Who may sign in (amends ADR 0021)

- **Any Google account** (`--email-domain=*`, unchanged). The only gate is Approval. ADR 0021's "the gates are the tailnet and then Approval" no longer holds: ADR 0025 made the app public.
- **No cap, no expiry, no allowlist.** A Pending User owns nothing and can call only `GET /api/me`, so a stranger's row costs one small row. Creating Google accounts in bulk is slow and often needs a phone number, which bounds Sign-up better than anything added here. Request volume is a separate question, decided in [Rate limiting tiers](https://github.com/bhh1893/health-tracker/issues/176).
- **Approve on an emailed match, never on the name.** The Admin approves only when the email shown by `users list` / `users approve` exactly matches an address the invitee sent through another channel (text, chat). Anyone can create a Google account with a familiar display name. `approve` already prints the row and asks `y/N`; this is a rule for the Admin, not code.

### The Sign-up brake

- **Storage:** a one-row table `signup` with `open boolean NOT NULL` and `changed_at timestamptz`, enforced to a single row (e.g. `id boolean PRIMARY KEY DEFAULT true CHECK (id)`). The migration inserts it with `open = true`, so a fresh install is open and the destination test needs no extra step. A restore carries the backed-up state: a brake closed during an incident stays closed after a rebuild.
- **Enforcement in `current_user`:** only on the unknown-`(issuer, sub)` path, before the Sign-up insert. If `open` is false: no insert, `403` Problem with type `urn:health-tracker:problem:signup-closed`. Known Users, including Pending ones, never read the setting, so normal requests pay nothing and the brake affects only new Users.
- **`web`:** on `signup-closed` from `GET /api/me`, shows "Sign-up is closed" with "Sign out", not the Pending screen.
- **Command (amends ADR 0022):** `iac/scripts/users signup close | open | status`, same `kubectl exec` path as the other subcommands. `close` and `open` print before and after and ask `y/N`. `users list` prints the brake's state in its header, because the state is not visible in git.
- **Runbook:** `docs/runbooks/signup-brake.md`, two levels, each with exact steps, a check and an undo:
  1. **Too many Sign-ups** (Pending rows piling up): `users signup close`; reopen with `users signup open`.
  2. **Too much traffic** (load on the home connection): also a Cloudflare custom rule blocking `/oauth2/start`. It stops requests at the edge, before the tunnel, but also blocks existing Users from signing in again until it is removed.

## Considered Options

- **Cap on Pending Users.** Rejected: an attacker fills the cap and the real invitee is locked out, turning a nuisance into a denial of service.
- **Expire stale Pending Users after N days.** Rejected for now: a scheduled job for a tidiness problem v1 does not have, and it can delete an invitee whom the Admin approves late.
- **Email allowlist (or the consent screen's Testing mode).** Rejected: a hand-kept list that repeats Approval, breaks "signs up with only a browser and a Google account", and matches on email, which ADR 0022 rejected for identity.
- **Brake as an env var (`SIGNUP_OPEN`) in the Kustomize overlay.** State visible and reviewed in git. Rejected: Argo CD's self-heal reverts `kubectl set env`, so closing takes a PR, merge, sync and rollout, and fails if GitHub or Argo is down. A brake has to act at once.
- **Cloudflare rule as the only brake.** Rejected as the primary: it also blocks existing Users' re-sign-in, and it cannot tell new identities from known ones. Kept as level 2 for traffic floods.

## Consequences

- **Amends ADR 0021:** "Who may sign in" now reads: any Google account; the gate is Approval alone. `GET /api/me` gains the `signup-closed` `403` for unknown identities while the brake is on.
- **Amends ADR 0022:** adds the `signup` table and the `users signup` subcommand; `list` shows the brake state.
- **Amends ADR 0006:** a new Problem type, `urn:health-tracker:problem:signup-closed`.
- A stranger who signs in leaves a name and email in the database and its backups indefinitely. Accepted for v1. **Deferred trigger:** when uninvited Sign-ups start appearing, add a way to remove them: `users reject <id>` for a Pending User who owns nothing, or expiry of Pending Users older than N days.
- The brake's state lives only in the database; `users signup status` and `users list` are the way to see it.
- **Verify at build:** with the brake closed, an unknown identity gets `signup-closed` and no row is written, while a known Pending User still gets `pending-approval` and a Member is unaffected; a fresh install starts open; `restore-data` keeps a closed brake closed; both runbook levels are walked once, including removing the Cloudflare rule.
