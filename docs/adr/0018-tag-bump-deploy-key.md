---
status: accepted
---

# Tag bump credential: a write deploy key, because the Actions app cannot bypass a ruleset on a personal repo

CI pushes the tag bump to `main` with a write deploy key held in a GitHub Actions secret, and deploy keys are the ruleset's bypass actor. ADR 0016 planned to bypass with the GitHub Actions app, but GitHub refuses it on a repo owned by a personal account: `Actor GitHub Actions integration must be part of the ruleset source or owner organization` ([ticket #56](https://github.com/bhh1893/health-tracker/issues/56)).

## Decision

- **Credential:** one ed25519 deploy key with write access, titled "health-tracker tag bump", stored as the Actions secret `TAG_BUMP_DEPLOY_KEY`. The private key is deleted after upload. Steps are in `docs/runbooks/secrets.md`.
- **Rulesets:** split in two, because a bypass applies to a whole ruleset. `main requires ci-gate` holds the PR and `ci-gate` rules and lets deploy keys bypass. `main history is protected` holds the deletion and force-push rules and has no bypass, so the key can add commits but not rewrite `main`.
- **Scope of the bypass:** GitHub's `DeployKey` actor means every deploy key on the repo. Argo CD's key is read-only, so this one key is the only one that can use it. Never add a second write key.

## Considered Options

- **A GitHub App owned by the user.** The usual choice at a company: tokens last an hour, and commits carry the app's identity. Rejected: an app registration and a private key to manage, plus a token-minting action, in order to change one file. The private key would be just as long-lived as this deploy key.
- **A fine-grained PAT.** Rejected, as in ADR 0016: it belongs to a person and expires, so deploys would stop on that date.
- **An unprotected deploy branch that Argo CD watches.** No credential or bypass needed. Rejected: manifests and tags would live on different branches, which breaks "`main` is what runs" and rollback by `git revert`.
- **Dropping the PR rule from `main`.** Rejected: it removes the protection ADR 0017 made the repo public to get.

## Consequences

- **Amends ADR 0016:** the bypass actor is deploy keys, not the Actions bot, and the bypass does not cover force-push or deletion. `bump-tags` needs no `contents: write`.
- **Amends ADR 0015:** a secret joins the inventory that lives only in GitHub, not in `~/.config/health-tracker/`. Nothing else consumes it and it can be regenerated, so a copy on the dev VM would only be another place to leak it.
- A deploy key push fires workflows, unlike a `GITHUB_TOKEN` push, so `paths-ignore` on `.github/workflows/ci.yml` is now the only guard against a loop.
- The key does not expire. Rotation stays on suspected exposure only (ADR 0015).
- GitHub cannot restrict the key to one file, so "touches only the overlay" is held by workflow code alone. Forked PRs do not receive the secret; anyone with write access to the repo could read it from a workflow.
- A deploy key added through `gh` is tied to that login: de-authorizing `gh` removes it, and bumps fail until it is re-added.
