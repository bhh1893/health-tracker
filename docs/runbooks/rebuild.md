# Rebuild everything

Destroys the three cluster nodes and brings the app back with its data, with no manual step (ADR 0004, 0011, 0016). The dev VM is not touched: it holds the backups and the secrets (ADR 0009, 0015).

> **Warning:** this destroys all three nodes and everything on them. Check that no other session is using the cluster, and run `iac/scripts/backup-status` on the dev VM first: the rebuild restores from what the bucket holds, so a stale backup means lost data (ADR 0011).

## One command (Windows)

From the repo root:

```
.\iac\rebuild-cluster.ps1            # restore the newest backup
.\iac\rebuild-cluster.ps1 -Fresh     # first install only: empty database
```

Add `-Ref origin/<branch>` to run Ansible and the scripts from a pushed branch. Argo CD still deploys `main`.

Exit code 0 and a last line of `REBUILD OK` mean everything below passed. Anything else means do not trust the cluster.

## What it does, in order

1. **Checks** the dev VM has its tools and the ref exists. Nothing is destroyed until these pass.
2. **Destroys and creates the nodes** (`vagrant destroy`, `vagrant up`) and waits for SSH.
3. **Runs `site.yml` twice.** The second run must report `changed=0` everywhere: that is the proof each role is idempotent. It installs Kubernetes, Cilium, and the platform (CNPG, cert-manager and its Let's Encrypt issuers, Barman plugin, Argo CD with its `Application`, the edge Gateway). Auto-sync is off. The platform role runs `apply-secrets` just before the Gateway, so the saved certificate is back before cert-manager can see the Gateway and issue a new one (ADR 0025).
4. **Waits** for all 3 nodes `Ready` and Cilium healthy.
5. **`restore-data`** (`--fresh` with `-Fresh`). Runs `apply-secrets` first, then creates `pg` from the newest backup, checks both roles can log in, and takes a base backup. See `backup-restore.md` for each step.
6. **`deploy-app`** turns Argo CD auto-sync on and waits for all of: `Synced`, `Healthy`, the sync operation `Succeeded`, and the `api-smoke` Job succeeded. Behind that sits the `PreSync` migration Job, the `api` and `web` rollout, and the `PostSync` smoke Job.

The order is the point. Secrets before the Gateway, secrets before `pg`, `pg` before the app, and auto-sync last, so Argo CD never starts `api` against a database that does not exist yet.

## Why `-Fresh` is a flag

A restore with an empty bucket stops with an error instead of starting empty, and `-Fresh` with a backup in the bucket stops too (ADR 0015). Both mistakes would otherwise look like a successful rebuild with the data gone.

On `-Fresh`, the `PreSync` Job runs every Alembic migration from an empty database, so a green run proves `0001` and `0002` apply cleanly from nothing. On a restore, the database is already at head and the Job changes nothing.

## When it fails

Each step is safe to re-run from the dev VM. Run the scripts from `~/rebuild-checkout`, which is the ref the rebuild used.

| Failed at | State | Do |
| --- | --- | --- |
| Nodes, Ansible, Ready, Cilium | No `pg`, no app | Fix the cause, run the whole rebuild again. See `cluster-nodes.md`. |
| `restore-data` | `pg` missing or restoring, `api` not deployed yet | Read the message, fix, run `iac/scripts/restore-data` (add `--fresh` if that is what you ran). See `backup-restore.md`, "If it fails". |
| `deploy-app` | Data is back, app is not | `kubectl -n argocd get application health-tracker`, then `kubectl -n health-tracker logs job/api-migrate` or `job/api-smoke`. Fix, then run `iac/scripts/deploy-app`. |

Common causes at the last step:

- **`ImagePullBackOff`.** The nodes cannot reach `ghcr.io`, or the package is not public (ADR 0016).
- **Argo CD cannot read the repo.** The deploy key in `~/.config/health-tracker/argocd-deploy-key` is not registered on GitHub, which happens after a dev VM rebuild. `docs/runbooks/secrets.md`.
- **Migration fails.** The sync ends `Failed` after Argo CD's retries, about 7 minutes. Read the Job log; the fix goes through git like any deploy.

## By hand

If a script is the problem, the steps are the same as the table: nodes and Ansible (`cluster-nodes.md`), `iac/scripts/apply-secrets`, `iac/scripts/restore-data`, then:

```
kubectl -n argocd patch application health-tracker --type=merge \
  -p '{"spec": {"syncPolicy": {"automated": {"prune": true, "selfHeal": true}}}}'
kubectl -n health-tracker get job api-smoke
```

## Drill

A rebuild is a restore drill and a deploy drill in one, but it only proves what the bucket held. After changing anything in this path:

1. Log a meal and a set on the phone, so there is data to lose.
2. `iac/scripts/backup-status`, and take a backup by hand if it is old (`postgres.md`).
3. Run the rebuild. Time it, and write the result under "Results" below.
4. Open the app on the phone. The meal and the set are there.
5. Once, on a throwaway basis, run it with `-Fresh` after emptying the bucket, to see the migrations apply from nothing.

## Results

The first two ran on 2026-11-15 from `origin/main` at `bdb4e80`, the third on 2026-11-16 from `origin/gateway-certificate` at `e907895` (#146). None had a manual step between the command and `REBUILD OK`, which also means the second playbook run reported `changed=0` on every host.

| Run | Time | Proof |
| --- | --- | --- |
| `rebuild-cluster.ps1` | 19m37s | Restored from `pg-20261109T065551Z`. Row counts in all six data tables matched the counts taken before the rebuild, Alembic at `0002`, `api-smoke` succeeded, `backup-status` OK on the new generation. |
| `rebuild-cluster.ps1 -Fresh` | 19m04s | Bucket emptied first (160 objects, 4 generations). The `api-migrate` log shows `-> 0001` then `0001 -> 0002` on an empty database. One seeded user, every other table empty, `api-smoke` succeeded, `backup-status` OK with 0 archive failures. |
| `rebuild-cluster.ps1` (Gateway certificate) | 18m39s | `apply-secrets` restored `edge/health-tls` before the Gateway: the served certificate kept its first issuance (`notBefore` 2026-11-16 08:29:54 UTC), the `Certificate` was Ready with no `Order` or `CertificateRequest`, and `curl --resolve` on `:443` returned `200` with no `-k`. Nothing was issued (ADR 0025). |

So recovery time (RTO) for losing all three nodes is about 20 minutes, nearly all of it creating the VMs and the two playbook runs. The amount of data makes no visible difference yet.

Notes from the runs:

- Nothing in the repo empties the bucket, and the dev VM has no S3 client. It was done with a throwaway script that lists every key and sends an S3 `DELETE` for each, signed by `curl --aws-sigv4` the way `restore-data` signs its listing.
- The old `pg` keeps archiving WAL until its node is destroyed, so start the `-Fresh` rebuild right after emptying. WAL without a base backup does not trip the `-Fresh` guard.
- Start it with `powershell.exe -NoProfile -File <full path with forward slashes>` when not already in a PowerShell prompt at the repo root.
