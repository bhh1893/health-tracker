# Build the cluster

Takes the three nodes from freshly created to "all Ready with Cilium healthy" (ADR 0004). Step 1 runs on Windows, the rest on the dev VM. The dev VM needs the `cilium` CLI: if it is missing, re-run `dev.yml` first (see `dev-vm.md`). The same playbook also installs the platform components: see `platform.md`.

## Rebuild in one command (Windows)

> **Warning:** this destroys all three nodes and everything on them. Check that no other session is using the cluster.

From the repo root:

```
.\iac\rebuild-cluster.ps1
```

This runs steps 1 to 3 below, waits for all nodes `Ready` and Cilium healthy, then restores the database and deploys the app: see `rebuild.md`, which is the runbook for the whole rebuild. It took about 13 minutes on 2026-11-05, before `site.yml` installed the platform components, so expect longer now. Exit code 0 means all of that passed, and the last line reads `REBUILD OK`. Anything else means do not trust the cluster.

- Ansible runs from `~/rebuild-checkout` on the dev VM, set to `origin/main`, so unpushed work is not tested. To test a branch, push it and pass `-Ref origin/<branch>`.
- The Vagrantfile comes from your Windows checkout.
- Do not edit `~/rebuild-checkout`: each run discards changes there.

The rest of this runbook is the same work by hand, for when you need to see or repeat one step.

## 1. Create the VMs (Windows)

From the repo root:

```
cd iac/vagrant/cluster
vagrant up
```

## 2. Clear old host keys (dev VM, only after recreating nodes)

Recreated nodes have new host keys, so SSH refuses them until the old entries are gone. Skip this the first time.

```
ssh dev
for ip in 10 11 12; do ssh-keygen -R 192.168.56.$ip; done
```

## 3. Run the playbook (dev VM)

```
cd ~/health-tracker/iac/ansible
ansible-galaxy collection install -r requirements.yml
ansible-playbook site.yml
ansible-playbook site.yml
```

Both must show `failed=0`, and the second must show `changed=0` on every node. Running from `iac/ansible` matters: that is where Ansible finds `ansible.cfg`.

## Check it worked

Password login must be refused:

```
ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password vagrant@192.168.56.11
```

This must print `Permission denied (publickey)`, with no password prompt.

Each worker must have one default route per IP version, both on `enp0s3`:

```
ssh -i ~/.ssh/health-tracker-ops vagrant@192.168.56.11 'ip route show default; ip -6 route show default'
```

Workers' LAN addresses come from the router and can change on reboot. Nothing depends on them.

All nodes must be `Ready`, on `192.168.56.x` addresses, and Cilium must report `OK`:

```
kubectl get nodes -o wide
cilium status
```

WireGuard must cover all nodes:

```
cilium encryption status
```

This must print `Encryption: Wireguard (3/3 nodes)`.

## Check nothing is reachable from the LAN

The nodes have no NIC on the home LAN (ADR 0025), so a LAN device has no way in but the tunnel. To check, run this in an admin PowerShell on the Windows host, which is on the home Wi-Fi. It sends traffic for one worker's pod range to the address that worker had on the LAN before #147, then tries the Postgres primary:

```powershell
route add 10.244.2.0 mask 255.255.255.0 192.168.0.100
Test-NetConnection 10.244.2.64 -Port 5432
Test-NetConnection 192.168.0.250 -Port 443
route delete 10.244.2.0
```

Take the pod range and IP from `kubectl get pods -n health-tracker -o wide` (`pg-1`). Both must print `TcpTestSucceeded : False`. Before #147, on 2026-11-17, both printed `True`: a LAN device could reach Postgres directly, because the node forwarded traffic to its pods, and the node firewall only filtered traffic addressed to the node itself.

## What to expect when a worker dies

Not yet measured on the tunnel path. Expect `cloudflared` on the surviving worker to carry every request: each pod holds its own connections to Cloudflare, so losing one drops only the requests in flight on it. The earlier measurement (2026-11-05, about 20s of failures, then 50s of intermittent ones) was for the LAN IP moving between workers, which is gone.

A worker that comes back rejoins by itself, and Cilium reports `OK` within a few minutes. Its `cilium status` shows errors until then.
