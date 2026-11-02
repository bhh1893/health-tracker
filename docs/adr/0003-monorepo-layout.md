---
status: accepted
---

# Monorepo layout: files live with their lifecycle, services share only the contract

A file lives with the thing whose lifecycle it shares. If it changes, builds, and deploys with one service, it lives in that service; if it serves the cluster or several services, it lives at the root. Tiebreaker: "if I deleted this service tomorrow, would this file go with it?" Services share no code, only the API contract as a generated artifact, because the two services are in different languages (Python `api`, static JS `web`) and a shared library would couple their releases.

## Layout

```
services/
  api/                  FastAPI modular monolith (ADR 0001)
    src/  tests/  migrations/   Alembic migrations ship in the api image
    k8s/                Kustomize base: Deployment, Service, HTTPRoute, migration Job
    Dockerfile  pyproject.toml  (uv)
    openapi.json        generated from the Pydantic models, committed
  web/                  static client
    src/  k8s/  Dockerfile
iac/
  vagrant/              Vagrantfile for all VMs
  ansible/              node provisioning
  terraform/            later, cloud only; provider specifics live only under iac/
k8s/
  platform/<component>/ third-party: pinned Helm chart version + values.yaml
  envs/<env>/           Kustomize overlay per environment (first: vagrant), composing platform + service bases
docs/  GLOSSARY.md  CLAUDE.md  .github/
```

## Rules

- **`services/` is what we write; everything else at the root is platform or shared.**
- **No shared code library.** `api` generates `services/api/openapi.json` from its Pydantic models; CI regenerates it and fails on drift. `web` generates its client-side types from that file. A root `libs/` needs a concrete need from two services in the same language and its own ADR.
- **Self-contained builds.** Each service's Docker build context is its own directory (`docker build services/api`), so a service cannot read a sibling's files. Each service has its own dependency manifest and lint/test config; no root workspace.
- **No empty folders.** `services/<svc>/iac/` appears only when a service has infrastructure of its own (e.g. a bucket only `api` uses).
- **Helm for third-party, Kustomize for ours.** Cilium, cert-manager, Argo CD and similar install from their official charts, the path their docs and upgrades assume. `api` and `web` are plain YAML bases with per-environment overlays.

## Considered Options

- **Services at the root (`api/`, `web/`).** Rejected: mixes code we write with `iac/`, `k8s/`, `docs/`; the root rule no longer fits in one line.
- **A per-service `iac/` from day one.** Rejected: on Vagrant no service owns infrastructure; its only deploy artifacts are manifests.
- **Shared Pydantic package in a root `libs/`.** Rejected: `web` is not Python, and a shared package couples service releases. The contract already exists as OpenAPI.
- **Our own Helm chart for `api` and `web`.** Rejected for now: adds Go templating and a values layer over YAML with one environment. Converting two Kustomize bases into a chart later is small.
- **Root Python workspace (uv workspace).** Rejected: pays off with several Python packages; there is one.

## Consequences

- CI can filter by path: a change under `services/api/**` builds and tests only `api`.
- Every `api` change that touches request/response models also changes `openapi.json` in the same PR; the drift check enforces it.
- Moving to a cloud environment adds `k8s/envs/<cloud>/` and `iac/terraform/`; no file under `services/` changes.
