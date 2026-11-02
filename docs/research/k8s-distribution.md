# Research: Kubernetes distribution for 3 VirtualBox VMs

Ticket: #5 (child of map #2). Researched 2026-11-01 against official docs.

## Question

Which Kubernetes distribution (kubeadm, k3s, k0s) best fits 3 VirtualBox VMs provisioned by Ansible from an Ubuntu dev VM, given the learning goal (L4/L5) and a later move to managed cloud Kubernetes (EKS/AKS)? Cover resource needs, CNI, bundled ingress/storage, upgrade path, and how closely each mirrors EKS/AKS. Use the prior-art kubeadm code as the baseline.

## Terms

- **Distribution** - a packaging of Kubernetes plus the tooling to install and run it (like Linux distros package the kernel).
- **kubeadm** - the upstream Kubernetes project's own tool that bootstraps a cluster; you bring the container runtime, network plugin, and everything else.
- **k3s** - a single-binary, trimmed Kubernetes from Rancher/SUSE that bundles networking, ingress, storage, and a load balancer.
- **k0s** - a single-binary Kubernetes from Mirantis with no host dependencies, installed with its own SSH tool `k0sctl`.
- **Control plane** - the "brain" processes (API server, scheduler, controller manager, etcd) that store and reconcile cluster state.
- **Worker / node** - a machine that runs your app containers (pods).
- **Container runtime (CRI)** - the daemon that actually runs containers on a node; here `containerd`.
- **CNI (Container Network Interface)** - the plugin that gives each pod an IP and routes traffic between pods across nodes (Flannel, Calico, Cilium).
- **NetworkPolicy** - a Kubernetes firewall rule between pods; only enforced if the CNI implements it.
- **kube-proxy** - the per-node component that turns Service virtual IPs into real pod addresses using iptables rules; Cilium can replace it with eBPF.
- **eBPF** - a Linux kernel feature that runs small sandboxed programs in the kernel; Cilium uses it for fast networking and policy.
- **Ingress / Gateway API** - Kubernetes APIs for routing outside HTTP traffic to services; Gateway API is the newer successor to Ingress.
- **LoadBalancer Service** - a Service type that asks the platform for an external IP; clouds provide one, bare metal needs MetalLB, ServiceLB, or Cilium L2 announcements.
- **StorageClass / dynamic provisioning** - a recipe that lets a PersistentVolumeClaim automatically create a disk; clouds provide EBS/Azure Disk, bare metal needs something like local-path-provisioner.
- **Conformance** - passing the CNCF test suite, meaning standard Kubernetes manifests behave the same as on any other certified cluster.

## Findings

### 1. Versions in play (as of 2026-11-01)

- Supported upstream minors: 1.37, 1.36, 1.35 (1.34 reached EOL 2026-10-27). 1.31, which the prior-art code pins, went EOL 2025-11-11 and gets no security fixes. Source: https://kubernetes.io/releases/
- Cilium stable (1.20) lists Kubernetes 1.33-1.36 as e2e tested; 1.37 is not yet on the list. Source: https://docs.cilium.io/en/stable/network/kubernetes/compatibility/
- AKS's Cilium table currently tops out at 1.36. Source: https://learn.microsoft.com/en-us/azure/aks/azure-cni-powered-by-cilium
- EKS VPC CNI add-on ships for 1.31-1.37. Source: https://docs.aws.amazon.com/eks/latest/userguide/managing-vpc-cni.html
- **Kubernetes 1.35 is the last release that supports containerd 1.x; 1.36+ needs containerd 2.0+.** "If you are using containerd 1.X, you must switch to 2.0 or later before upgrading Kubernetes to the next version." Source: https://kubernetes.io/blog/2025/11/26/kubernetes-v1-35-sneak-peek/ and https://kubernetes.io/blog/2025/09/12/kubernetes-v1-34-cri-cgroup-driver-lookup-now-GA/
- Ubuntu 24.04 shipped containerd 1.7.12 and kernel 6.8. Source: https://discourse.ubuntu.com/t/noble-numbat-release-notes/39890

Implication: target Kubernetes **1.36** (supported until 2027-06-28, tested by Cilium, available on EKS and AKS), and install containerd 2.x from outside Ubuntu's archive (e.g. Docker's `containerd.io` apt package or upstream release binaries). The prior art's `apt install containerd` from Ubuntu will not work past 1.35.

### 2. Resource needs

| | Control plane / server | Worker / agent | Source |
|---|---|---|---|
| kubeadm | 2 CPU, 2 GB ("any less will leave little room for your apps") | 2 GB | https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/ |
| k3s | 2 CPU, 2 GB | 1 CPU, 512 MB | https://docs.k3s.io/installation/requirements |
| k0s | 1 vCPU, 1 GB | 1 vCPU, 0.5 GB | https://docs.k0sproject.io/stable/system-requirements/ |

All three exclude workload memory. On a 32 GB / 16-core host the difference does not matter: kubeadm with 4 GB per node (12 GB) plus a 3-4 GB dev VM still leaves about half the host for Windows. k3s/k0s savings only matter on small hosts. Exact sizing belongs to #8.

### 3. What comes in the box

| | CNI | NetworkPolicy | Ingress | LoadBalancer | Storage | Datastore |
|---|---|---|---|---|---|---|
| kubeadm | none (you pick) | depends on CNI | none | none | none | etcd |
| k3s | Flannel | built-in controller (can be disabled) | Traefik v3 | ServiceLB | local-path-provisioner | SQLite default; etcd optional |
| k0s | kube-router (Calico optional) | via kube-router/Calico | none | none | none (CSI guides) | etcd |

Sources: https://docs.k3s.io/, https://docs.k3s.io/cli/server, https://docs.k3s.io/networking/networking-services, https://docs.k0sproject.io/stable/networking/

k3s bundles are the fastest path to a working app, but each bundled piece is one you will replace on EKS/AKS anyway (ServiceLB vs cloud LB, local-path vs EBS/Azure Disk, SQLite vs managed etcd). Each can be turned off (`--disable=traefik`, `--disable=servicelb`, `--disable local-storage`, `--flannel-backend=none`), at which point k3s is roughly kubeadm with a different installer.

### 4. CNI choice

- **Flannel** (prior art): simple VXLAN overlay, but "does not natively enforce Network Policies." Source: https://github.com/flannel-io/flannel
- **Calico**: enforces NetworkPolicy, needs kernel 5.10+, uses BGP (TCP 179) or IP-in-IP/VXLAN. Source: https://docs.tigera.io/calico/latest/getting-started/kubernetes/requirements
- **Cilium**: eBPF dataplane, needs kernel 5.10+ (Ubuntu 24.04 has 6.8). Can replace kube-proxy, implements Gateway API v1.6.3 (passes all Core conformance tests, requires `kubeProxyReplacement=true`), and offers L2 announcements so a LoadBalancer Service gets an IP on the VirtualBox host-only network (beta). Sources: https://docs.cilium.io/en/stable/operations/system_requirements/, https://docs.cilium.io/en/stable/network/servicemesh/gateway-api/gateway-api/, https://docs.cilium.io/en/stable/network/l2-announcements/

Cloud mirror:
- AKS: Azure CNI Powered by Cilium is the default on AKS Automatic and an option on AKS Standard; it runs without kube-proxy and enforces NetworkPolicy natively. Source: https://learn.microsoft.com/en-us/azure/aks/azure-cni-powered-by-cilium
- EKS: VPC CNI is "the only CNI plugin supported by Amazon EKS for nodes that run on AWS infrastructure"; it enforces standard NetworkPolicy (v1.21.0+). Sources: https://docs.aws.amazon.com/eks/latest/userguide/managing-vpc-cni.html, https://docs.aws.amazon.com/eks/latest/userguide/cni-network-policy.html

Takeaway: whichever CNI you pick, the portable contract is standard `NetworkPolicy` and Gateway API objects. Cilium gives both locally, matches AKS directly, and the same manifests apply on EKS with VPC CNI. Flannel would silently ignore NetworkPolicy, so you could not test the edge/DB isolation you will want in the cloud.

### 5. Ingress: Ingress NGINX is retired

"In March 2026, Ingress NGINX maintenance will be halted, and the project will be retired... no updates to resolve any security vulnerabilities." Kubernetes recommends migrating to Gateway API. Source: https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/

So do not build on ingress-nginx. Gateway API is now on the CKA curriculum ("Use the Gateway API to manage Ingress traffic"). Source: https://github.com/cncf/curriculum (CKA_Curriculum_v1.37.pdf). Cilium's built-in Gateway API controller avoids installing a separate ingress controller; this is input for #11.

### 6. Storage

kubeadm and k0s ship no StorageClass. Rancher's local-path-provisioner (the same one k3s bundles) creates node-local volumes; the volume "is only accessible on the node where it was provisioned," with no capacity limits. Source: https://github.com/rancher/local-path-provisioner

For one Postgres instance this is fine if Postgres is pinned to one node, and it mirrors the cloud pattern (a zonal EBS/Azure Disk volume is also attached to one node at a time). Input for #10.

### 7. Upgrade path

- kubeadm: one minor at a time ("Skipping MINOR versions when upgrading is unsupported"), switch the `pkgs.k8s.io` apt repo per minor, upgrade control plane first, drain each node before a minor kubelet upgrade. Source: https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/
- k3s: replace the binary manually, or automate with Rancher's system-upgrade-controller. Traefik jumped v2 -> v3 at k3s 1.32, which needs a manual migration. Source: https://docs.k3s.io/upgrades
- k0s: `k0sctl` deploys and upgrades multi-node clusters "with one command." Source: https://docs.k0sproject.io/stable/

EKS/AKS upgrades follow the kubeadm mental model (control plane first, then node pools, one minor at a time), so kubeadm practice transfers directly.

### 8. Learning value and cloud fidelity

- CKA curriculum v1.37 lists "Create and manage Kubernetes clusters using kubeadm", "Manage the lifecycle of Kubernetes clusters", "Understand extension interfaces (CNI, CSI, CRI)", "Define and enforce Network Policies", and Gateway API. Source: https://github.com/cncf/curriculum
- kubeadm is upstream: same component layout (static-pod API server, etcd, kube-proxy or replacement) that EKS/AKS run for you. k3s collapses components into one process and defaults to SQLite, so its internals differ from what managed clouds run. k0s is "100% upstream" and CNCF certified but adds its own tool (`k0sctl`) that overlaps with Ansible.
- All three are conformant, so app manifests (Deployment, Service, NetworkPolicy, Gateway) port to EKS/AKS unchanged regardless of choice. The difference is in what you learn while running it.

## Prior-art assessment (`C:\Users\Bryan\Desktop\Work\vagrant`)

What it does well:
- Correct kubeadm prerequisites: swap off, `overlay`/`br_netfilter`, sysctls, containerd with `SystemdCgroup = true`, `pkgs.k8s.io` repo, packages held with `dpkg_selections`.
- Already found and fixed the classic VirtualBox trap: every VM's first NIC is NAT (10.0.2.15), so it pins kubelet `--node-ip` to the 192.168.56.x host-only address and forces Flannel onto that interface. Cilium needs the same `--node-ip` pin (https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/).
- Separate dev VM directory so `vagrant destroy` on the cluster never touches it.
- `creates:` guards make `kubeadm init` and `join` idempotent.

What breaks or should change:
1. **Kubernetes 1.31 is EOL** and the repo URL is hard-coded. Make the minor a variable; target 1.36.
2. **Ubuntu's containerd 1.7 cannot run Kubernetes 1.36+.** Install containerd 2.x (Docker apt repo `containerd.io` or upstream). containerd 2.x uses config version 3, so the `SystemdCgroup = false` line-replace must be re-verified against the generated file.
3. **Two provisioning paths that disagree.** The Vagrantfile runs `ansible_local` plus inline `kubeadm init` shell, while `control-plane.yml`/`worker.yml` duplicate it. The map decision is Ansible from the dev VM over SSH, so Vagrant should only create VMs and inject the dev VM's SSH key; all Kubernetes setup moves to one Ansible playbook run from the dev VM (#9).
4. **Join token through a synced folder.** `join_command.sh` holds a live join token and CA hash (`<redacted>`), written to `/vagrant`, which is the host directory. Tokens expire after 24h, so rebuilds re-run it anyway. Instead, generate it in the playbook (`kubeadm token create --print-join-command`), `register` it, and pass it to workers in memory. Delete the existing file and make sure it is never committed.
5. **Wrong SSH key for workers.** `inventory.ini` points both workers at `k8s-control`'s Vagrant private key; each Vagrant machine gets its own key. Moot once the dev VM owns a single key it installs on all nodes.
6. **Host key checking disabled** (`StrictHostKeyChecking=no`, `UserKnownHostsFile=/dev/null`). Acceptable for throwaway VMs; better to `ssh-keyscan` into known_hosts during provisioning.
7. **Flannel from `releases/latest`** is unpinned and enforces no NetworkPolicy. Replace with a pinned Cilium Helm chart.
8. **Init flags inline.** Move to a `kubeadm` config file (`ClusterConfiguration` + `InitConfiguration`) so pod CIDR, advertise address, `skipPhases: [addon/kube-proxy]`, and kubelet `node-ip` live in one versioned file.
9. **`swapoff` via `shell`** runs every time and is not idempotent; use `ansible.builtin.mount`/`lineinfile` plus a handler.
10. `control-plane.yml` targets `hosts: k8s-control` while the inventory group is `control_plane`; target the group.
11. Box version not pinned (`bento/ubuntu-24.04`); pin it so "rebuild all VMs from scratch" is reproducible.

## Options compared

| Criterion | kubeadm + Cilium | k3s (defaults) | k0s + k0sctl |
|---|---|---|---|
| Time to first working cluster | slowest | fastest | fast |
| Learning (CKA, L4/L5 infra) | highest: every piece is explicit | low: bundles hide CNI, LB, storage | medium |
| Mirrors EKS/AKS internals | closest (upstream layout; Cilium = AKS) | furthest (SQLite, ServiceLB, Traefik) | close, but own installer |
| Fits "Ansible from dev VM" | natural | fine (official Ansible collection exists) | overlaps with k0sctl |
| NetworkPolicy | yes | yes (built-in controller) | yes |
| Gateway API | built into Cilium | Traefik supports it | add a controller |
| Prior art reuse | high | low | low |
| Upgrade practice | real kubeadm flow | binary swap | one command |

## Recommendation

**Use kubeadm, Kubernetes 1.36, containerd 2.x, and Cilium as the CNI with kube-proxy replacement, Gateway API, and L2 announcements; add local-path-provisioner for storage.** One control-plane node and two workers.

Tradeoffs that decided it:
- **Learning is priority 1 on the map.** kubeadm makes you build each layer (CRI, CNI, storage, LB, ingress) that EKS/AKS later hide, and it is exactly what the CKA tests. k3s is simpler but teaches less, and its bundled pieces are all things you would replace in the cloud.
- **Cloud portability.** Upstream layout plus Cilium matches AKS's default dataplane, and standard NetworkPolicy and Gateway API objects port to EKS as well. Flannel would let you write NetworkPolicies that silently do nothing.
- **One component, three jobs.** Cilium covers pod networking, LoadBalancer IPs on the host-only network (no MetalLB), and Gateway API ingress (no ingress-nginx, which is retired). That keeps the component count close to k3s.
- **Resources are not a constraint** on a 32 GB / 16-core host, so k3s/k0s's main advantage does not apply.
- **Prior art is mostly reusable** after the fixes above.

What you give up: more moving parts to debug on day one, and Cilium L2 announcements are beta. Fallback if L2 announcements misbehave on VirtualBox: expose the Gateway via NodePort or install MetalLB (decide in #11).

## Open questions

- Kubernetes 1.37: Cilium stable does not list it yet. Re-check Cilium's compatibility page before pinning; 1.36 is the safe choice now.
- containerd source: Docker's `containerd.io` package vs upstream tarball vs a newer Ubuntu archive package. Pick one in #9 and confirm it is 2.x via `apt-cache policy`.
- Whether Cilium L2 announcements work cleanly with VirtualBox host-only adapters was not verified in docs; needs a spike during build.
