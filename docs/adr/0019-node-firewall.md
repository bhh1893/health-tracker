---
status: accepted
---

# Node firewall: nftables for what netfilter can see, `nodePort.addresses` for what it cannot

Workers admit only port 80 from the home LAN, using two controls because no single one covers everything. An nftables table on the bridged NIC filters host services and the Gateway. A Cilium setting keeps NodePorts off that NIC, because Cilium handles them in eBPF before netfilter runs ([ticket #85](https://github.com/bhh1893/health-tracker/issues/85)).

The constraint that shaped it, measured on a worker with a default-drop nftables table on `eth2`:

| Traffic | Result | Packets nftables counted |
| --- | --- | --- |
| Host services (SSH, kubelet, Hubble, metrics) | blocked | all of them |
| Plain NodePort | still served | 0 |
| Gateway, through TPROXY to Envoy | blocked unless accepted | all of them, original port intact |

Cilium's `cil_from_netdev` program runs at tc ingress on `eth2`, ahead of netfilter, and forwards plain NodePort packets from there. Gateway traffic is delivered to Envoy on the host, so it passes through netfilter's `input` hook.

## Decision

- **Host services and the Gateway:** role `node_firewall`, on the Vagrant-only `bridged` group like `bridged_nic`. On `eth2` it accepts replies, DHCP and TCP 80, and drops the rest. Other NICs are untouched, so Ansible and cluster traffic on `eth1` cannot be locked out.
- **NodePorts:** `nodePort.addresses: ["192.168.56.0/24"]` in the Cilium values, so they are served on the host-only network only. LoadBalancer IPs are separate frontends, so `192.168.0.250` keeps working.
- **Own table, own unit:** the role loads `table inet node_firewall` from `node-firewall.service`. Cilium's iptables rules share the ruleset, and Ubuntu's stock `nftables.service` and `/etc/nftables.conf` both run `flush ruleset`, which would remove them and break the Gateway. The stock service stays disabled.

## Considered Options

- **Cilium's host firewall.** One enforcement point, in eBPF, that sees all of this traffic. Rejected: host policy applies to every device Cilium manages, so a bad rule could cut `eth1` as well, which loses the lockout protection above. It is also a larger change to the datapath than one value.
- **nftables at the `netdev` ingress hook.** Rejected: it still runs after tc ingress, so NodePorts bypass it too.
- **`allocateLoadBalancerNodePorts: false` on the Gateway Service.** Rejected: it fixes one Service, and any later NodePort would be exposed again.

## Consequences

- **Amends ADR 0010:** the node firewall is nftables plus `nodePort.addresses`, not an Ansible role alone.
- **Amends ADR 0004:** `node_firewall` joins the role list.
- nftables does not cover eBPF-handled traffic. A new listener on a host port is blocked by default, but anything Cilium serves before netfilter must be checked with a LAN probe, not assumed closed.
- `192.168.56.0/24` is a further copy of the host-only subnet, and it is Vagrant-specific. A cloud overlay must set its own value, or NodePorts have no address to serve on.
- Cilium reads this value when the agent starts, and Helm does not restart agents for a config change. On a running cluster, follow a change with `kubectl -n kube-system rollout restart ds/cilium`.
