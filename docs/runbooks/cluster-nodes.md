# Build the cluster

Takes the three nodes from freshly created to "all Ready with Cilium healthy" (ADR 0004). Step 1 runs on Windows, the rest on the dev VM. The dev VM needs the `cilium` CLI: if it is missing, re-run `dev.yml` first (see `dev-vm.md`). The same playbook also installs the platform components: see `platform.md`.

## Rebuild in one command (Windows)

> **Warning:** this destroys all three nodes and everything on them. Check that no other session is using the cluster.

From the repo root:

```
.\iac\rebuild-cluster.ps1
```

This runs steps 1 to 3 below, then waits for all nodes `Ready` and Cilium healthy. It took about 13 minutes on 2026-11-05, before `site.yml` installed the platform components, so expect longer now. Exit code 0 means all of that passed, and the last line reads `REBUILD OK`. Anything else means do not trust the cluster.

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

## Check the node firewall

Run this from a device on the home LAN, not the dev VM, which reaches the workers over the host-only network. Use the workers' `eth2` addresses from `ip -br addr show eth2`, and any NodePort from `kubectl get svc -A`.

Only the Gateway may answer. Port 22, 10250 and every NodePort must time out on each worker's LAN address, and `http://192.168.0.250/` must load.

The workers' own LAN addresses show nothing open, even port 80: the Gateway listens only on `192.168.0.250`.

Never run `systemctl start nftables` on a node. It flushes the whole ruleset, including Cilium's rules, and the Gateway stops working (ADR 0019).

## What to expect when a worker dies

Measured on 2026-11-05 by powering off the worker announcing `192.168.0.250`, once each way, with a backend pod on each worker. Windows probed every second; the phone recovered by itself in roughly the same 20s:

- About 20s: the IP moves to the other worker (the 15s lease expires, then a new election).
- Until about 50s: some requests still fail, which fits the dead pod staying a backend until the node goes `NotReady`.
- After that: all requests succeed.

A worker that comes back rejoins by itself, and Cilium reports `OK` within a few minutes. Its `cilium status` shows errors until then.
