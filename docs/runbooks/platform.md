# Platform components

`site.yml` installs local-path-provisioner, the CNPG operator, cert-manager, the Barman Cloud plugin and Argo CD with Helm, after Cilium (ADR 0005, ADR 0011, ADR 0016). Everything here runs on the dev VM. To install or upgrade, run the playbook as in `cluster-nodes.md`: twice, the second must show `changed=0`.

To bump a version, edit that component's `k8s/platform/<component>/versions.yml`, after reading its release notes. Check the chart still supports the cluster's Kubernetes version.

## Check it worked

All five releases must be `deployed`, and every pod `Running`:

```
helm list -A
kubectl get pods -n local-path-storage
kubectl get pods -n cnpg-system
kubectl get pods -n cert-manager
kubectl get pods -n argocd
```

The CNPG and plugin CRDs must exist:

```
kubectl get crd clusters.postgresql.cnpg.io objectstores.barmancloud.cnpg.io
```

A PVC on `local-path` shows `Pending` until a pod uses it. That is `WaitForFirstConsumer` working, not a fault: the volume is a directory on one node, so the scheduler has to pick the node first.

## Open the Argo CD UI

```
kubectl port-forward svc/argocd-server -n argocd --address 0.0.0.0 8080:80
```

Browse to `http://192.168.56.20:8080` from Windows. The forward lasts until you press Ctrl-C.

The user is `admin`. Read the password yourself in a terminal, never through Claude (ADR 0015):

```
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
```

## Argo CD auto-sync

`k8s/platform/argocd/application.yaml` has no `syncPolicy`, so a new cluster starts with auto-sync off. The setting lives only in the cluster, and re-running Ansible leaves it alone. To turn it on:

```
kubectl -n argocd patch application health-tracker --type merge -p '{"spec":{"syncPolicy":{"automated":{"prune":true,"selfHeal":true}}}}'
```

- `selfHeal` reverts manual changes to anything Argo CD owns, so `kubectl scale deploy/api` does not stick.
- `prune` deletes what was removed from git, such as an old `api-sidecar-<hash>` ConfigMap. It only touches resources Argo CD tracks, so `pg` and the Secrets are safe.

To check it, and to see why a deploy failed:

```
kubectl -n argocd get application health-tracker
kubectl -n health-tracker logs job/api-migrate
kubectl -n health-tracker logs job/api-smoke
```
