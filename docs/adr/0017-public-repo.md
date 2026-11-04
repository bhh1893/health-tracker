---
status: accepted
---

# Public repository: rulesets and required checks need it on GitHub's free plan

The repo is public. GitHub's free plan does not offer branch rulesets or required status checks on private repositories (the API answers `403 Upgrade to GitHub Pro or make this repository public`), and both ADR 0014 (`ci-gate` as the one required check) and ADR 0016 (a ruleset with a bot bypass) depend on them ([ticket #41](https://github.com/bhh1893/health-tracker/issues/41)).

## Decision

- Make `bhh1893/health-tracker` public. Before flipping, the full git history was scanned with `gitleaks` and found clean.
- Nothing secret may ever be committed again. Public history is copied and indexed within minutes, so a leak is handled by rotating the secret (ADR 0015), not by deleting the commit.

## Considered Options

- **GitHub Pro (about $4/month), repo stays private.** The cleanest fit: ADRs 0014 and 0016 hold unchanged. Rejected by the owner: they would rather not pay and are comfortable publishing the code.
- **No enforcement, rely on discipline.** Rejected: the user is the only reviewer, which is exactly when a skipped check slips through, and the ADR 0016 bot bypass has nothing to bypass.
- **Self-hosted enforcement (a server-side hook).** Rejected: GitHub has no such hook; this would mean hosting git ourselves.

## Consequences

- **Amends ADR 0016:** "the repo stays private" no longer holds. Argo CD could clone anonymously, but the read-only deploy key stays as written until a later ticket decides to drop it; no change to the secret inventory.
- GHCR packages built from a public repo are public by default, so the one-time visibility flip in ADR 0016 is no longer needed.
- Everything in `docs/` and the ADRs is world-readable: internal IPs (`192.168.x.x`) and design details are visible. Accepted: the cluster is reachable only on the home LAN and gated by a token (ADR 0010).
- `gitleaks` in `ci-gate` is now the primary guard against publishing a secret, not a nicety.
- GitHub Actions minutes are free and unmetered for public repositories.
- Reversible only in effect, not in fact: making it private again hides the repo but not copies others have taken.
