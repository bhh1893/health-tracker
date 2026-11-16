---
status: accepted
---

# Patching internet-facing components: Dependabot for dependencies, release-watch for the edge, nothing merges without the owner

Going public changes who can exploit a known bug, not the software. Behind the tailnet only the owner could reach oauth2-proxy, Envoy or the app, so "bump when convenient" was fine. Now anyone can, and the hostname is published in Certificate Transparency logs, which scanners read. The time between an upstream fix and that fix running in the cluster becomes the exposure window, so new versions must be noticed and applied on a clock. GitHub's own Dependabot covers what it can read, release-watch emails and a monthly sweep cover the rest, and no third-party app gets write access. Decided in [Patching internet-facing components](https://github.com/bhh1893/health-tracker/issues/178). This amends ADR 0016 and ADR 0014 and follows from ADR 0025.

## Shape

### Scope

- **Everything pinned in the repo:** app images and their base images, Python and npm dependencies, GitHub Actions, sidecar images, and the platform charts in `k8s/platform/*/versions.yml`.
- **The edge set**, what a visitor's request touches, carries the deadlines below: oauth2-proxy, Cilium (its Envoy is the Gateway), `cloudflared`, `web`'s nginx, and `api`'s Python dependencies (FastAPI and uvicorn parse requests from Pending Users before they get `403`).
- Node OS packages stay on Ubuntu's unattended-upgrades, unchanged.

### Noticing

- **Dependabot alerts on:** GitHub matches the lockfiles against its advisory database and emails the owner. Read-only.
- **Dependabot security updates on:** when an alert has a fixed version, Dependabot opens the PR itself.
- **Dependabot version updates** in `.github/dependabot.yml` for `pip`, `npm`, `github-actions` and `docker` (Dockerfiles): **monthly**, one grouped PR per ecosystem.
- **Release-watch** for what Dependabot cannot read (`versions.yml` pins, image pins in Kubernetes manifests): on GitHub, Watch -> Custom -> Releases and Security advisories on oauth2-proxy, Cilium and `cloudflared`. The runbook lists every watched repo.
- **Monthly sweep**, on the same day as the Dependabot PRs: compare every pin Dependabot cannot read against its latest release, and bump what is behind. The same sweep checks the tunnel's connectors in the Cloudflare dashboard: exactly two, both from the home IP; anything else means rotating the tunnel token (ADR 0030).

### Pinning

- **Edge-set images are pinned by tag and digest**, `image: <name>:<tag>@sha256:<digest>`, so a moved tag cannot change what runs without a PR. The digest for a manual bump comes from `docker buildx imagetools inspect <name>:<tag>`. Dependabot keeps Dockerfile digests current itself.
- Helm charts stay pinned by version: classic chart repositories publish no digests.

### Deadlines

- **Security fix in the edge set:** live within **7 days** of the upstream release, within **48 hours** when it is rated critical or is being actively exploited.
- **Everything else:** the monthly cycle.

### Applying

- **Nothing merges without the owner.** No automerge in v1: the oauth2-proxy and Cilium bumps need manual steps anyway, and those are the ones that matter most.
- **Argo-owned** (app images, oauth2-proxy sidecars): the merge deploys and the smoke test checks it (ADR 0016). **After an oauth2-proxy bump**, run the signed-in forged-identity-header check by hand (ADR 0014).
- **Ansible-owned** (Cilium and the other platform charts, and `cloudflared`, ADR 0029): the merge deploys nothing. Run the platform playbook, then from the phone on cellular check that `/api/v1/meals` gives `401` and `/` shows the Sign-in page.
- The steps, the watch list and the sweep checklist live in `docs/runbooks/patching.md`.

### The deploy key stays on `main` (amends ADR 0016, ADR 0018)

- `TAG_BUMP_DEPLOY_KEY` moves from a repository secret into a GitHub **Environment** that only `main` may deploy to, and the `bump-tags` job names that Environment. Today `ci.yml` runs on `pull_request`, and PRs from branches in this repo receive repository secrets, so anything able to push a branch could edit the workflow, read the key, push to `main` past `ci-gate`, and Argo would deploy it. Push access to a branch would mean deploy access to the cluster. With the Environment, a branch can no longer read the key.

## Considered Options

- **Renovate (hosted GitHub App).** It reads custom files through regex managers, so it would also bump `versions.yml` and manifest images, and it opens PRs that trigger CI. Rejected: a third party with write access to a repo where, until the key moves, write access reaches the cluster. The edge set is about five pins, few enough to watch by hand.
- **Renovate self-hosted in Actions.** Rejected: PRs opened with `GITHUB_TOKEN` do not trigger workflows (ADR 0016), so it needs another long-lived credential.
- **Manual only, no Dependabot.** Rejected: Dependabot is GitHub itself, already trusted as the host, and its PRs receive no repository secrets. It takes the busywork for the ecosystems it reads.
- **Automerge for low-risk updates** (Actions, dev dependencies). Rejected for v1: it saves a few clicks a month and adds rules to remember. Revisit if the monthly review becomes a chore.
- **Cilium under Argo**, so every merge deploys. Rejected, as in ADR 0016: a broken CNI cuts Argo off from the cluster it would need to roll back.
- **Image scanning in CI** (Trivy). Rejected, keeping ADR 0016: it mostly reports OS-package CVEs with no fixed version to apply, and adds a CI gate that can fail on noise. Upstream security releases cover what can be acted on.
- **Weekly version updates.** Rejected: four times the PRs for no security gain, since security updates do not wait for the cycle.

## Consequences

- **Amends ADR 0016:** "base images are pinned to an exact tag; bumping is a manual PR" becomes Dependabot for what it reads and release-watch plus the monthly sweep for the rest; edge-set images add a digest. `TAG_BUMP_DEPLOY_KEY` lives in a `main`-only Environment.
- **Amends ADR 0018:** the bump key is an Environment secret, not a repository secret. Steps in `docs/runbooks/secrets.md` change accordingly.
- **Amends ADR 0014:** the forged-header check after an oauth2-proxy bump is a step in `docs/runbooks/patching.md`.
- Noticing an edge-set release depends on the owner reading the watch emails. A missed email is caught by the monthly sweep at the latest, which can exceed the 7-day deadline; accepted for one owner.
- A Cilium bump is two steps, merge then playbook. A merged but unapplied bump leaves the repo and the cluster out of step until the playbook runs.
- Image OS packages are patched only when upstream ships a new image.
- **Verify at build:** Dependabot opens one grouped PR per ecosystem and `ci-gate` runs on it; a Dependabot PR does not receive `TAG_BUMP_DEPLOY_KEY`; after the move, a workflow run on a PR branch cannot read the key and `bump-tags` on `main` still pushes; Watch -> Custom offers Security advisories on each watched repo.
