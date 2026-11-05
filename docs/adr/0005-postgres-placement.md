---
status: accepted
---

# Postgres placement: in-cluster with the CloudNativePG operator

Postgres runs inside the Kubernetes cluster, managed by the CloudNativePG (CNPG) operator: we declare a `Cluster` resource and the operator creates the pods, Services, replication, failover and backups. Node disks are never trusted to keep data across a rebuild: every rebuild restores from an off-node backup. `api` knows only a `DATABASE_URL`, so moving to a managed database (RDS, Azure Database) in v2 changes the overlay and a Secret, not service code.

## Shape

- **Operator:** CNPG installed with Helm from `k8s/platform/cnpg/` into namespace `cnpg-system`, by CD (ADR 0004: Ansible stops at Cilium).
- **Cluster:** `Cluster` named `pg` in the app namespace, next to `api`, because a pod can only read Secrets from its own namespace. `bootstrap.initdb` creates database `health` owned by role `app`. A second role, `api_rw`, and both passwords are managed as in ADR 0015.
- **Version:** Postgres major 18 pinned (ADR 0002 needs native `uuidv7()`). Minor updates by image tag bump; CNPG rolls the replica, then switches over the primary. A major upgrade is a planned event, method chosen when it happens.
- **Instances:** 2, a primary and a streaming replica, with required pod anti-affinity so they sit on different workers. CNPG fails over automatically. The replica is for availability (drain a worker without downtime), not durability: it copies mistakes instantly.
- **Storage:** `local-path` StorageClass, one 5 Gi volume per instance holding data and WAL together. A separate WAL volume would sit on the same virtual disk and gain nothing. local-path cannot expand volumes, so resizing means a restore.
- **Resources per instance:** memory request = limit = 512 Mi, CPU request 250m, no CPU limit (avoids throttling on a node with idle CPU), `shared_buffers` 128 MB.
- **App contract:** `api` and the migration Job each read one `DATABASE_URL` env var from their own Secret (`db-api`, `db-owner`), pointing at the `pg-rw` Service. Amended by ADR 0015, which replaces CNPG's generated `pg-app` Secret. No CNPG names or libraries in service code.
- **Pooling:** none. SQLAlchemy's built-in pool is enough for one user; CNPG's `Pooler` (PgBouncer) can be added later without code changes.
- **Rebuild rule:** `rebuild-cluster.ps1` destroys every local-path volume. Data comes back only by bootstrapping `pg` from a backup stored outside the 3 node VMs, so every rebuild is also a restore drill.

## Considered Options

- **Postgres on its own VM, installed by Ansible.** Closest in shape to a managed database, and a cluster rebuild leaves it alone. Rejected: a 5th VM, an Ansible Postgres role and hand-built backup tooling (pgBackRest), and it never teaches stateful workloads on Kubernetes. The v2 move to a managed database is the same "change `DATABASE_URL`" step either way.
- **Hand-written StatefulSet.** Rejected: init, users, backups, failover and upgrades would all be ours to build, producing a worse CNPG.
- **Single instance.** Rejected: draining or losing the one worker holding the volume takes the database down until a restore. The replica costs about 0.5 GB RAM, which the 4 GB workers have.
- **Shared network storage (NFS, Longhorn) so the volume can follow the pod.** Rejected: CNPG's guidance is local disks plus Postgres streaming replication (shared-nothing). Network storage adds a component and a latency path for no gain.
- **A separate `db` namespace.** Rejected: CNPG's generated Secret would have to be copied into the app namespace.

## Consequences

- local-path has no volume snapshots, so CNPG backups must go to S3-compatible object storage (Barman Cloud plugin) somewhere off the node VMs. Where that lives is decided in ADR 0011 (Garage on the dev VM).
- Each worker carries one Postgres instance; a worker's RAM budget includes 512 Mi for it.
- The DDL (migration) vs read/write (`api`) role split is decided in ADR 0015: role `app` for the migration Job, `api_rw` for `api`.
- v2 on a managed database: delete `Cluster` `pg` and the CNPG chart, point the overlay's `DATABASE_URL` at the managed endpoint. Backups and failover become the provider's job.
