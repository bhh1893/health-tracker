---
status: accepted
---

# Provisioning split: Vagrant creates machines, Ansible configures them

Vagrant does only what Terraform plus cloud-init will do in a cloud: create the VM (CPU, RAM, disk), attach NICs and IPs, set the hostname, and inject one SSH public key. Ansible, run from the dev VM, owns everything from the OS up to "all 3 nodes Ready with Cilium". Moving to a cloud in v2 replaces `iac/vagrant/` with `iac/terraform/` and adds an inventory; the Ansible roles do not change.

## Shape

- **Base OS:** Ubuntu 26.04 LTS (`bento/ubuntu-26.04`, box version pinned) on all VMs. containerd 2.x comes from Ubuntu's own archive; kubeadm, kubelet, kubectl come from `pkgs.k8s.io`, pinned to 1.36.
- **Two Vagrantfiles:** `iac/vagrant/cluster/` (3 nodes) and `iac/vagrant/dev/` (dev VM), so destroying the cluster can never destroy the workstation. Synced folders off. Amends ADR 0003.
- **One Vagrant provisioner on cluster nodes, and it only injects the key:** an inline shell step appends the ops public key, the equivalent of cloud-init's `ssh_authorized_keys`. Vagrant cannot add a key without a provisioner. The dev VM also gets a short shell bootstrap (the cloud-init equivalent): install `ansible-core` and place the ops private key. The rest of the dev VM belongs to Dev VM setup.
- **SSH:** one ed25519 **ops key** generated once on the Windows host (`~/.ssh/health-tracker-ops`, outside the repo). Vagrant injects the public half on every node; only the dev VM holds the private half. Ansible's first role disables password SSH (bridged workers are visible on the LAN). `StrictHostKeyChecking=accept-new`; the rebuild script clears old host keys with `ssh-keygen -R` before recreating nodes.
- **Inventory:** static, committed, one per environment: `iac/ansible/inventories/vagrant/hosts.yml`, groups `control_plane`, `workers`, `k8s_cluster`, plus `bridged` in the Vagrant inventory only. The 3 node IPs are duplicated between the Vagrantfile and the inventory, on purpose.
- **Roles (our own):** `base` (swap, kernel modules, sysctl, SSH hardening, host keys), `bridged_nic`, `containerd`, `kube_packages`, `control_plane`, `worker`, `cilium`, composed by `site.yml`. Collection versions pinned in `requirements.yml`.
- **Environment-specific fixes:** `bridged_nic` stops the workers' bridged NIC adding default routes (IPv4 and IPv6), leaving the NAT NIC as the only way out. It targets the `bridged` group, so `site.yml` stays the same in a cloud, where the group is empty.
- **Host keys:** the Bento box ships one set of SSH host keys, shared by every VM built from it. `base` replaces them once per node, then clears the old entry from the controller's `known_hosts`.
- **Bootstrap:** `kubeadm init` reads a committed kubeadm config file (pod/service CIDRs, `node-ip` on `192.168.56.x`, kube-proxy phase skipped). `kubeadm join` reads no config file, because `join --config` needs the token inside it; workers set `node-ip` in `/etc/default/kubelet` instead. The join command is created on the control plane at run time, held in memory as a registered variable with `no_log`, and never written to disk. The admin kubeconfig is copied to the dev VM straight after `init`, because Cilium is then installed with Helm from `k8s/platform/cilium/`, run on the dev VM.
- **Ansible stops at:** all nodes Ready with Cilium healthy. cert-manager, local-path-provisioner, any GitOps agent and apps belong to CD.
- **Idempotency:** modules over `shell`; init guarded by `/etc/kubernetes/admin.conf`, join by `/etc/kubernetes/kubelet.conf`. Contract: a second consecutive run reports `changed=0`.
- **Updates:** unattended security updates stay on; containerd, kubelet, kubeadm, kubectl are `apt-mark hold`. Changing the Kubernetes version in v1 means a rebuild, not `kubeadm upgrade`.
- **One-command rebuild:** `iac/rebuild-cluster.ps1` on Windows destroys and recreates the 3 nodes, clears their host keys, runs the playbook twice over `ssh dev` (failing if the second run changes anything), then waits for all nodes Ready and Cilium healthy, exiting non-zero otherwise. The dev VM is never touched.
- **Testing:** CI runs `ansible-lint` and `yamllint` on `iac/ansible/**`. GitHub-hosted runners cannot run VirtualBox, so the real test is the rebuild script on real VMs. No Molecule.

## Considered Options

- **Vagrant runs `ansible_local` and inline shell (the prior art).** Rejected: `vagrant up` becomes the only way to configure a node, node setup is duplicated across shell and Ansible, the join token lands in the host-shared `/vagrant` folder, and none of it carries to a cloud.
- **Vagrant's `cloud_init` option for the key injection.** Rejected: the closest match to the cloud path, but it sits behind an experimental flag, and a one-line provisioner does the same job.
- **Ubuntu 24.04 with containerd 2.x from Docker's apt repo or GitHub binaries.** Rejected: a third-party source to trust, pin and upgrade when 26.04 ships 2.x in its own archive.
- **Kubespray.** Rejected for v1: production-grade, but thousands of variables hide init, join and CNI, which this project exists to teach.
- **Vagrantfile parses the Ansible inventory for IPs.** Rejected: couples Vagrant to Ansible's file format to save three lines.
- **Ansible also installs every platform component.** Rejected: two tools would own the same resources once a GitOps agent exists.
- **Disabling SSH host key checking.** Rejected: removes impostor-host protection; explicit cleanup on rebuild is enough.
- **Fixing the routes with a second Vagrant provisioner, or a conditional in `base`.** Rejected: the first breaks the one-provisioner rule above; the second puts Vagrant knowledge in a role that must carry over unchanged.
- **Molecule for role tests.** Rejected: kubeadm in containers is unreliable and the rebuild script already tests on real VMs.

## Consequences

- "Rebuild all VMs" in the v1 definition of done means the 3 cluster nodes; the dev VM is rebuilt deliberately and separately.
- Two checkouts exist: one on Windows (Vagrant only) and the working one on the dev VM.
- The ops private key is a long-lived credential on the dev VM; losing the dev VM means regenerating it and re-running `vagrant up --provision`.
- In a cloud, Ansible needs a network path to private VMs (bastion or similar); that is a v2 decision.
