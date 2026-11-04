---
status: accepted
---

# Backup storage and restore: MinIO on the dev VM, daily base backup plus continuous WAL, restore by script

CNPG backs up to an S3-compatible bucket served by MinIO on the dev VM. Postgres ships its change log (WAL) continuously and takes one base backup a day at 21:00, keeping 7 days. Restore is a bash script on the dev VM that deletes the `pg` Cluster and recreates it from the newest backup; `rebuild-cluster.ps1` calls the same step, so every rebuild is also a restore drill ([Backup storage and restore](https://github.com/bhh1893/health-tracker/issues/22)). This answers the open question in ADR 0005.

## Shape

- **Target:** MinIO installed by `iac/ansible/dev.yml` as one pinned binary under systemd (no Docker needed for it), data in `/var/lib/minio`, listening on `192.168.56.20:9000` over plain HTTP on the host-only network. Pods reach it through their node; it never crosses Wi-Fi. At build, verify MinIO's current community-edition status; Garage or SeaweedFS are S3-compatible fallbacks and nothing on the cluster side changes.
- **Credential:** a dedicated MinIO access key limited to the backup bucket, not the root login. `dev.yml` generates it once into `~/.config/health-tracker/backup.env` (mode 600, outside the repo). The scripts read that file and create the Kubernetes Secret. The wider secrets design (shared secret, DB roles) stays in the secrets ticket.
- **Schedule and retention:** continuous WAL archiving (a base backup is only restorable together with its WAL, so this is not optional) plus a CNPG `ScheduledBackup` at 21:00. Retention policy 7 days. A run missed because the machines were off is skipped, not caught up. Data-loss window while everything is up: about a minute.
- **Two overlays:** `fresh` bootstraps with `initdb` (empty database); `restore` bootstraps with `recovery` from the newest backup. A recovered cluster cannot archive into its parent's folder, so each generation writes to a new `serverName`, `pg-<timestamp>`, and reads from the newest existing folder. The bucket is the only record of generations; nothing is stored in the cluster, which is what gets destroyed.
- **Choosing an overlay:** the script lists the bucket. A backup found means `restore`; an empty bucket means `fresh`. A `-Fresh` flag forces an empty database.
- **`restore-data` (bash, `iac/scripts/`, run on the dev VM):** stop `api`, delete `pg`, apply the `restore` overlay (optional `--at <time>` for point-in-time recovery), wait for healthy, check row counts, restart `api`. It needs only `kubectl`, not Vagrant, so it is not PowerShell. `docs/runbooks/backup-restore.md` explains every step.
- **Rebuild:** `rebuild-cluster.ps1` (ADR 0004) ends by calling `restore-data` over `ssh dev`.
- **`backup-status` (bash):** prints the last base backup's age and WAL archive health; exits non-zero if the last backup is over 36 hours old or archiving is failing. The runbook says to run it weekly. No alerting in v1.
- **Acceptance for build tickets:** one full restore drill passes before the setup is trusted, and MinIO is pinned.

## Considered Options

- **A cloud bucket (Backblaze B2, R2, S3) from the start.** Better durability (survives losing the PC) and no WAL-pileup risk, but an account and a credential to manage in v1. Deferred to v2, where it is a swap of endpoint and credentials, since the S3 API is the same.
- **MinIO on the Windows host.** Rejected: same disk as the VMs, and a service outside the Vagrant/Ansible stack that the runbook cannot rebuild.
- **MinIO in the cluster.** Rejected: a rebuild would destroy the backups it exists to survive.
- **Daily base backup only.** Not possible: CNPG backups require WAL archiving.
- **One script for fresh install and restore, templating one manifest.** Rejected for two overlays: each is readable on its own and the choice is one visible branch in the script.
- **A manual `kubectl` runbook only.** Rejected: restore is six steps with exact YAML, a typo while deleting `pg` loses the database, and "one command" is part of v1's definition of done. The runbook remains so every step is understood.

## Consequences

- **Amends ADR 0009:** the dev VM now holds the backups, so it is no longer stateless. Destroying it destroys the only backup copy; its runbook gets a warning and the "no unique state" line is corrected.
- Backups share the PC's disk and do not survive losing it. Accepted for v1; fixed by the v2 cloud bucket.
- If only the dev VM is halted while the cluster runs, WAL piles up on the 5 Gi Postgres volume and can eventually stop the database. Powering off the whole PC is safe. `backup-status` is the mitigation.
- `dev.yml` gains a MinIO role, bucket and key creation; CNPG needs the Barman Cloud plugin installed from `k8s/platform/`.
- Every rebuild exercises restore, but rebuilds are occasional, hence the weekly `backup-status` check.
