# Postgres

`pg` is a CNPG `Cluster` in namespace `health-tracker`: a primary, a streaming replica, continuous WAL to Garage on the dev VM, and a base backup every day at 21:00 UTC (ADR 0005, ADR 0011). The manifests are in `k8s/envs/vagrant/pg/`. Run everything on the dev VM from the repo root. Argo CD does not manage `pg` (ADR 0016).

## Create an empty database

Only for a first install. This is the `fresh` overlay, which starts with no data.

```
iac/scripts/apply-secrets
gen="pg-$(date -u +%Y%m%dT%H%M%SZ)"
kubectl kustomize k8s/envs/vagrant/pg/fresh | sed "s/pg-GENERATION/$gen/" | kubectl create -f -
kubectl -n health-tracker wait cluster/pg --for=condition=Ready --timeout=400s
```

`gen` is the `serverName`: this generation's folder in the bucket (ADR 0011). The command uses `create`, not `apply`, so it fails if `pg` already exists.

## Check it worked

```
kubectl -n health-tracker get cluster pg
kubectl -n health-tracker get pods -o wide
kubectl -n health-tracker get cluster pg -o jsonpath='{.status.conditions[?(@.type=="ContinuousArchiving")].status}'; echo
```

Expect `Cluster in healthy state`, `pg-1` and `pg-2` on different workers, and `True`.

## Change a setting on the running cluster

Edit `base/`, then apply with the live `serverName`. Applying the placeholder would point archiving at a folder called `pg-GENERATION`. Add `--dry-run=server` first to check.

```
gen=$(kubectl -n health-tracker get cluster pg -o jsonpath='{.spec.plugins[0].parameters.serverName}')
kubectl kustomize k8s/envs/vagrant/pg/fresh | sed "s/pg-GENERATION/$gen/" | kubectl apply -f -
```

The `bootstrap` block, including the locale, is read only when the cluster is created. Changing it later does nothing.

## Take a backup now

```
kubectl -n health-tracker create -f - <<YAML
apiVersion: postgresql.cnpg.io/v1
kind: Backup
metadata:
  name: pg-manual-$(date -u +%Y%m%d%H%M%S)
spec:
  cluster:
    name: pg
  method: plugin
  pluginConfiguration:
    name: barman-cloud.cloudnative-pg.io
YAML
kubectl -n health-tracker get backup
```

The phase must reach `completed`. It runs on the replica when one is healthy, so it does not load the primary.

## Test failover

```
kubectl -n health-tracker delete pod "$(kubectl -n health-tracker get cluster pg -o jsonpath='{.status.currentPrimary}')"
kubectl -n health-tracker get cluster pg -w
```

The replica takes over within seconds, and the old primary comes back as a replica on its own worker. The new primary's `pg_stat_archiver` shows `failed_count` 1 for a `.history` file, with `switchover in progress, refusing archiving` in its log. That is one refused attempt during promotion, which Postgres retries. Worry only if `ContinuousArchiving` stays `False`.

## Good to know

- With 2 workers and required anti-affinity, draining a worker leaves its instance `Pending` until the worker returns. The database keeps running on the other one, with no replica.
- If the dev VM is off while the cluster runs, WAL piles up on the 5 Gi volume (ADR 0011).
