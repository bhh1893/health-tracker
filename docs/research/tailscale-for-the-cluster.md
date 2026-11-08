# Tailscale for the cluster

Research for [#119](https://github.com/bhh1893/health-tracker/issues/119), map [#117](https://github.com/bhh1893/health-tracker/issues/117). Sources read 2026-11-07. "Verify at build" marks claims the docs did not settle.

## Recommendation

Run the **Tailscale Kubernetes Operator** (Helm chart, in `k8s/platform`) and expose the existing Cilium Gateway's Service on an **ingress ProxyGroup**. The operator then creates a **Tailscale Service** (for example `svc:health`) with a stable tailnet virtual IP (TailVIP) that survives proxy and cluster rebuilds. Point `health.<domain>` at that TailVIP; TLS stays on the Gateway (cert-manager DNS-01, ticket #120). Admit other people by **inviting them as users** into the tailnet (Personal plan: up to 6 users), and use grants so invited users can reach only `svc:health` on 443.

**Main alternative: a subnet router advertising `192.168.0.250/32`.** It is simpler: no operator, and the Gateway keeps its LAN IP. It loses because `192.168.0.0/24` is the most common home subnet. On a friend's Wi-Fi in that range, iOS can prefer the Wi-Fi route over the Tailscale route ([tailscale#14142](https://github.com/tailscale/tailscale/issues/14142)), so the app breaks off the home network. A `100.x` TailVIP cannot clash with a LAN, and the same name works at home, at the gym and anywhere else.

## 1. Operator vs subnet router vs `tailscale serve`

| | Operator, L3 ProxyGroup → Gateway Service (recommended) | Subnet router for `192.168.0.250/32` | `tailscale serve` on a host |
| --- | --- | --- | --- |
| Address the phone uses | TailVIP of a Tailscale Service, stable across rebuilds | LAN IP, can clash with foreign LANs | `<host>.<tailnet>.ts.net`, a second TLS endpoint |
| TLS | Gateway (cert-manager, ADR 0010 v2) | Gateway | Tailscale's Let's Encrypt cert on the host, not `health.<domain>` |
| Fits kubeadm + Cilium | Yes, with `socketLB.hostNamespaceOnly: true` (below) | Yes | Needs a host outside the cluster's lifecycle |
| Rebuild | Operator re-auths with the OAuth client; the Service and its VIP are reused | Node re-auths with an auth key or OAuth secret; route re-approved by `autoApprovers` | Host not rebuilt, so no churn, but it is a pet |

Facts behind the table:

- **Operator exposure modes.** L3: a `LoadBalancer` Service with `loadBalancerClass: tailscale`, or the annotation `tailscale.com/expose: "true"`. L7: an `Ingress` with `ingressClassName: tailscale`, which uses Serve and gives a `ts.net` MagicDNS name with a Let's Encrypt cert. HA: the annotation `tailscale.com/proxy-group` on the Ingress or Service "creates a Tailscale Service for the group" and works for L3 and L7 ([cluster ingress](https://tailscale.com/kb/1439/kubernetes-operator-cluster-ingress), [HA](https://tailscale.com/docs/kubernetes-operator/manage-and-configure/high-availability)). HA needs Tailscale 1.84+.
- **Cilium caveat.** With kube-proxy replacement and socket LB on (our setup, ADR 0004), "connections from Pods to ClusterIPs bypass Tailscale firewall rules attached to netfilter hooks". You must enable the socket LB bypass in pod namespaces to expose a Service as a Tailscale LoadBalancer, through `tailscale.com/expose`, or through a `Connector` ([compatibility](https://tailscale.com/docs/kubernetes-operator/reference/compatibility)). In the Cilium Helm values that is `socketLB.hostNamespaceOnly: true`, set in the Ansible `cilium` role. The same page says to pass Cilium `--devices` so it does not pick up `tailscale0`'s MTU. Verify both at build.
- **Wiring the Gateway's Service.** Cilium generates the Gateway's `LoadBalancer` Service, so we cannot edit it directly. Put the two annotations (`tailscale.com/expose`, `tailscale.com/proxy-group`) on the `Gateway` under `spec.infrastructure.annotations`, which Gateway API propagates to generated resources. Verify at build that the pinned Cilium version propagates them, and that in-cluster traffic to the Gateway's ClusterIP reaches Envoy.
- **L7 operator Ingress was not chosen.** It would put a second TLS terminator and a `ts.net` hostname in front of the Gateway, which conflicts with `health.<domain>` (#120). Keep it as a fallback if #120 drops the own domain.
- **`tailscale serve` can proxy to a remote target** such as `http://192.168.0.250`. The CLI only warns on platforms without that support, for example "Linux tailscaled without SO_MARK" ([serve_v2.go](https://github.com/tailscale/tailscale/blob/main/cmd/tailscale/cli/serve_v2.go)). It still needs a long-lived host, and the only stable one is the dev VM, which then becomes production. Rejected.
- **Subnet router mechanics** (if the alternative is chosen): IP forwarding plus `tailscale set --advertise-routes`. Routes are approved by hand or by `autoApprovers`. Traffic is SNATed by default. "If you use tags, key expiry is disabled by default" ([subnet routers](https://tailscale.com/kb/1019/subnets)). The operator's `Connector` resource can run it in a pod instead of on a node.

### What a rebuild does

- **Credentials.** The operator authenticates with an **OAuth client** that has write scopes General/Services, Devices/Core and Keys/Auth Keys, tagged `tag:k8s-operator`, with `tagOwners` making `tag:k8s-operator` the owner of `tag:k8s` ([install](https://tailscale.com/docs/kubernetes-operator/install-operator)). The operator mints auth keys for its proxies itself, so the OAuth client ID and secret are the only secret. It is long-lived and comes from the ADR 0015 store on every rebuild. The Helm chart reads it from the `operator-oauth` Secret or `oauthSecretVolume` ([values.yaml](https://github.com/tailscale/tailscale/blob/main/cmd/k8s-operator/deploy/chart/values.yaml)).
- **Workload identity federation** would remove that secret, but "the Kubernetes cluster's OIDC discovery endpoints must be publicly accessible" ([WIF](https://tailscale.com/docs/kubernetes-operator/manage-and-configure/workload-identity-federation)). This is impossible on the home network. Revisit in a cloud.
- **Device churn.** Each rebuild registers a new operator device and new proxy devices. The old ones stay as offline machines, because nothing deletes them when the VMs are destroyed. Device names then get suffixes, which does not matter because clients use the Tailscale Service name and VIP, not device names. Optional cleanup is a Tailscale API call in `rebuild-cluster.ps1`. Ephemeral nodes are not an answer: Personal includes only 1,000 ephemeral-resource minutes a month ([pricing](https://tailscale.com/pricing)).
- **Service identity survives.** A Tailscale Service "keeps the same address when you move it to another host" ([Tailscale Services](https://tailscale.com/kb/1552/tailscale-services)). A new operator finding an existing Service whose owners are other operator instances adds itself as an owner instead of failing ([ingress-for-pg.go `ownerAnnotations`](https://github.com/tailscale/tailscale/blob/main/cmd/k8s-operator/ingress-for-pg.go)). After a rebuild, the same `svc:health` name and VIP come back, and `health.<domain>` needs no DNS change. Service hosts must be tagged, and new hosts need approval, so add `autoApprovers.services` for `tag:k8s`.
- **Let's Encrypt.** Not a Tailscale concern with this design, because the Gateway's cert-manager owns the cert (ADR 0010 already notes rebuild re-issuance).

## 2. Admitting others

- **Node sharing does not work here.** "A machine cannot be shared with a tag or accessed by tagged machines on another tailnet", and "shared machines do not advertise subnets" ([sharing](https://tailscale.com/kb/1084/sharing)). Operator proxies and Service hosts are always tagged, and a subnet router's routes are not shared either.
- **Invite users into the tailnet.** "Inviting external users into your tailnet will give them access to subnet routers" (same page), and the same applies to Services. The free Personal plan allows **up to 6 users, unlimited user devices, 50 tagged resources and 3 ACL groups**, non-commercial use only ([pricing](https://tailscale.com/pricing)). Six users, the owner included, is enough for v1 and is a hard ceiling to note in the ADR.
- **Restrict them.** Replace the default allow-all policy. Example grant: `src: ["autogroup:member"]`, `dst: ["svc:health"]`, `ip: ["tcp:443", "tcp:80"]` (80 only for the redirect). Owner devices keep broader access. With no other grants, invited users cannot reach the nodes, the dev VM or each other. Consider device approval so a new invitee's device is not live until approved.
- **Tailnet admission is not app admission.** The app's Pending/Member/Admin gate (map #117) still applies.

## 3. Identity

- **Serve identity headers.** Serve sets `Tailscale-User-Login`, `Tailscale-User-Name` and `Tailscale-User-Profile-Pic`, strips spoofed copies, and skips tagged sources ([serve](https://tailscale.com/kb/1312/serve); [serve.go `addTailscaleIdentityHeaders`](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go)). The docs say they are also populated for "external users who have accepted a share of your device". **The recommended L3 path does not get them**: an L3 proxy forwards packets, not HTTP. Only the L7 operator Ingress or `serve` would, and both were rejected above.
- **tsidp** is an OIDC provider that identifies callers by `whois` over the tailnet. It is **experimental** ("might experience breaking changes"), needs a `tailscale.com/cap/tsidp` grant and persistent state, and ships Docker Compose rather than Kubernetes instructions ([tsidp docs](https://tailscale.com/docs/features/tsidp), [README](https://github.com/tailscale/tsidp)). In the source, `sub` is the Tailscale numeric user ID, and tagged callers are rejected ("tagged nodes not supported", [token.go](https://github.com/tailscale/tsidp/blob/main/server/token.go)). Users from other tailnets cannot reach it, because tsidp itself runs as a tagged node and tagged nodes cannot be shared. It works for invited users. Hand to #121 as a candidate: passwordless and zero-click, but experimental and it couples sign-in to Tailscale.
- **Recommendation.** Take identity from the OIDC flow (#121), not from Tailscale headers. That keeps identity out of the network layer and portable if the overlay changes.

## 4. Phone behaviour

- **iOS.** The app "automatically configures a broad VPN On Demand policy while Tailscale is enabled" so the tunnel survives restarts, updates and crashes. Custom rules per Wi-Fi, cellular and Ethernet are optional, and only one VPN app can use On Demand at a time ([VPN On Demand](https://tailscale.com/kb/1291/ios-vpn-on-demand)). Leave it on everywhere: with a TailVIP there is no reason to drop Tailscale on home Wi-Fi.
- **Android.** Use the OS "Always-on VPN" setting for Tailscale ([Android VPN docs](https://developer.android.com/develop/connectivity/vpn#always-on)). Some users report reconnect problems after reboot with "Block connections without VPN" on ([forum](https://forum.tailscale.com/t/android-alwayson-waning-sentiments-re-tailscale/3984)), so leave that off.
- **Home Wi-Fi with Tailscale on.** Works. The phone reaches the TailVIP through the tailnet, not the LAN. The path may go through a DERP relay if NAT traversal into the pod fails: the proxy sits behind pod networking and the VirtualBox NAT NIC. Check with `tailscale ping` at build. Latency is fine for form posts. The subnet-router alternative would have the LAN-overlap problem described above.

## 5. Cloud-agnostic fit

- **Tailscale lives in platform layers only.** The operator Helm chart and CRDs (`ProxyGroup`, ProxyClass) sit in `k8s/platform`. The Gateway gets two annotations. Cilium gets one value in the Ansible role. The tailnet policy (tags, `autoApprovers`, grants) should be kept as code, for example a committed policy file applied through the Tailscale API or the Terraform provider in `iac/`.
- **Services stay unaware.** `api` and `web` contain no Tailscale code. Identity comes from OIDC (#121).
- **Portable.** The operator needs only outbound internet (HTTPS and UDP to DERP and peers), so the same manifests run on AWS or Azure. In a cloud, WIF can replace the OAuth secret if the issuer is public.

## Open items for the decision ticket

- Confirm Tailscale Services and L3 ProxyGroups are available on the Personal plan. Pricing does not list them; check the admin console. If not, the fallback is a single-proxy L3 `LoadBalancer`, whose `100.x` IP changes when the device is replaced, so DNS would need updating on each rebuild.
- Confirm that a public DNS A record pointing at a `100.64.0.0/10` address is not filtered by the resolvers in use (#120 owns DNS).
- Store the OAuth client secret under ADR 0015, with a rotation story.
