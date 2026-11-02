# HTTPS on the home network

Research for issue #6 (map #2, Health Tracker v1). Researched 2026-11-01.

**Question:** How can a site on a home VirtualBox Kubernetes cluster be served over HTTPS that an iPhone or Android browser trusts without warnings? Compare a private CA (mkcert, step-ca, cert-manager CA issuer) against a real domain with Let's Encrypt DNS-01 for a private IP. Cover phone trust setup, renewal, carry-over to v2, and whether the phone can reach the cluster at all.

## Answer

Buy a cheap domain, host its DNS on a provider with an API (Cloudflare is free and built into cert-manager), point a subdomain such as `ht.home.example.com` at the ingress's private LAN IP, and let **cert-manager** get a **Let's Encrypt** certificate with the **DNS-01** challenge. No phone setup, automatic renewal, and the exact same Issuer works unchanged in v2. Getting the phone to reach the cluster comes first: give the ingress a LAN IP via VirtualBox **bridged** networking (Vagrant `public_network`), with Windows port forwarding as the fallback.

The private CA route works too, but it means installing and trusting a root on every phone, it does not carry into v2 at all, and the root's private key turns into a long-lived secret you have to guard.

## Terms

- **TLS / HTTPS**: TLS encrypts a connection and proves the server's identity with a certificate. HTTPS is HTTP over TLS.
- **Certificate (cert)**: a file that binds a name (like `ht.example.com`) or IP to a public key, signed by a CA.
- **CA (certificate authority)**: whoever signs certificates. A browser trusts a cert only if it chains up to a **root** CA in the device's **trust store** (its list of trusted roots).
- **Public CA**: a CA that phones already trust out of the box (Let's Encrypt is one). **Private CA**: one you create yourself, which devices trust only after you install its root.
- **SAN (Subject Alternative Name)**: the field in a cert that lists the names/IPs it is valid for.
- **ACME**: the protocol Let's Encrypt (and step-ca) use to issue certificates automatically.
- **Challenge**: how an ACME CA checks you control a name. **HTTP-01** fetches a file from your server over the public internet. **DNS-01** looks up a TXT record you publish in DNS.
- **cert-manager**: a Kubernetes add-on that requests, stores (as a Kubernetes Secret) and renews certificates. An **Issuer/ClusterIssuer** is its config object for "where certs come from".
- **Ingress controller**: the in-cluster reverse proxy at the edge that receives HTTPS, decrypts it (**TLS termination**) and forwards to the app.
- **Secure context**: the browser's term for a page loaded in a trusted way (HTTPS or localhost). Many APIs only work there.
- **PWA (Progressive Web App)**: a website that can be "installed" to the home screen and work like an app. A **service worker** is the background script that lets it cache and work offline.
- **Bridged networking**: the VM appears on your home LAN as its own device with its own IP from your router. **NAT**: the VM hides behind the host and is not reachable from the LAN without port forwarding. **Host-only**: VMs and the host can talk, nothing else can.
- **Split-horizon DNS**: the same name resolves differently inside vs outside your network.
- **DNS rebinding protection**: a router feature that drops public DNS answers pointing at private IPs (192.168.x.x etc.).

## Step 0: can the phone reach the cluster?

HTTPS is moot if packets do not arrive. VirtualBox's modes ([VirtualBox networking manual](https://www.virtualbox.org/manual/topics/networkingdetails.html)):

| Mode | Reachable from phone? |
|---|---|
| NAT (Vagrant default adapter) | Only via port forwarding on the host. "the virtual machine is invisible and unreachable from the outside internet." |
| NAT Network | Same, port forwarding needed. |
| Host-only | No. VMs "cannot talk to the world outside the host". |
| Bridged | Yes. The VM gets a real LAN address. |

**Recommended: bridged adapter on the 3 node VMs.** In Vagrant this is `config.vm.network "public_network", bridge: "<exact Windows adapter name>"`, optionally with a static `ip:` ([Vagrant public networks](https://developer.hashicorp.com/vagrant/docs/networking/public_network)). Keep the private/host-only network for node-to-node and dev-VM traffic, and add bridged as a second NIC.

Then give the ingress one stable LAN IP. On bare metal, a Service of type LoadBalancer has no cloud to hand out IPs, so **MetalLB** (layer 2 mode) fills that role: one node answers ARP for a virtual IP and another takes over if it dies ([MetalLB L2 concepts](https://metallb.universe.tf/concepts/layer2/)). Reserve a small range outside the router's DHCP pool for it. This is good L4/L5 learning (ARP, VIPs, failover) and is exactly how bare-metal clusters do it.

Gotchas to check:

- **Wi-Fi host adapter**: "most wireless adapters do not support promiscuous mode", so VirtualBox rewrites source MAC addresses on bridged Wi-Fi traffic ([VirtualBox manual](https://www.virtualbox.org/manual/topics/networkingdetails.html)). IPv4 works, but MetalLB's ARP announcements through a MAC-rewriting Wi-Fi bridge are untested here. If the Windows host is on Ethernet, this is a non-issue.
- **Vagrant boxes have well-known insecure credentials**, and bridged makes them reachable by anything on your Wi-Fi ([Vagrant docs](https://developer.hashicorp.com/vagrant/docs/networking/public_network)). Disable password SSH / swap the insecure key in provisioning.
- **Router "client/AP isolation"** or a guest network blocks phone-to-LAN traffic. The phone must be on the same main network.

**Fallback if bridged is flaky:** keep nodes host-only and forward the host's LAN port 443 to the ingress, either with VirtualBox NAT port forwarding (`VBoxManage modifyvm --natpf1`) or Windows `netsh interface portproxy`, and open 443 in Windows Firewall for the Private profile. This works but hides the cluster behind the Windows host, so MetalLB failover means nothing and you learn less.

## What you lose on plain HTTP

A LAN IP over `http://` is **not** a secure context. Only `https`, `localhost` and loopback (`127.0.0.0/8`, `::1`) qualify ([MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)). Lost on plain HTTP ([MDN: features restricted to secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts/features_restricted_to_secure_contexts)):

- **Service workers**: no offline caching or queueing entries while Wi-Fi drops.
- **PWA install**: Chrome requires the app to "Be served over HTTPS" to offer install ([web.dev install criteria](https://web.dev/articles/install-criteria)). No proper home-screen app.
- Web Crypto, async Clipboard, Notifications/Push, Geolocation, Storage API (persistent storage), Web Authentication (passkeys, relevant to v2 passwordless auth).

Also: the shared secret would cross Wi-Fi in cleartext. HTTPS is worth it in v1.

## Options compared

### A. Private CA (mkcert, step-ca, or cert-manager CA issuer)

You create a root CA, install it on each phone, and sign the ingress cert with it.

- **mkcert**: one-command local CA. The CA cert and key live in `mkcert -CAROOT`. The key "gives complete power to intercept secure requests from your machine. Do not share it." For phones: "you will have to install the root CA. It's the `rootCA.pem` file", on iOS via AirDrop/email/HTTP then "enable full trust in it" ([mkcert README](https://github.com/FiloSottile/mkcert)). Leaf certs last 2 years 3 months, under Apple's 825-day limit "that macOS/iOS apply to all certificates, including custom roots"; the root lasts 10 years ([mkcert cert.go](https://github.com/FiloSottile/mkcert/blob/master/cert.go)). Renewal is manual: re-run, re-create the Kubernetes Secret.
- **step-ca**: a real online CA server with ACME support; "Certificates from `step-ca` expire in 24 hours by default" and renewal must be automated ([step-ca docs](https://smallstep.com/docs/step-ca/), [production guide](https://smallstep.com/docs/step-ca/certificate-authority-server-production/)). Teaches PKI operations but is one more stateful service to run and back up.
- **cert-manager CA issuer**: bootstrap a root with a `SelfSigned` issuer, store it as a Secret with `tls.crt`/`tls.key`, and cert-manager issues and renews leaf certs from it. Caveats: "There's no automatic rotation for the CA certificate", and certs "will not be publicly trusted" ([cert-manager CA issuer](https://cert-manager.io/docs/configuration/ca/)). If you rebuild the cluster from scratch (a v1 goal), you must restore that CA Secret from backup or re-trust a new root on every phone.

**Phone trust setup:**

- **iPhone**: install the `.pem` as a profile, then Settings > General > About > Certificate Trust Settings > "Enable full trust for root certificates" ([Apple 102390](https://support.apple.com/en-us/102390)). Certs must use RSA >= 2048 or ECDSA, SHA-2, the name in SAN, `serverAuth` EKU and <= 825 days validity ([Apple 103769](https://support.apple.com/en-us/103769)). mkcert and cert-manager defaults meet this.
- **Android**: Settings > Security > Encryption & credentials > Install a certificate > CA certificate, accept the warning. Since Android 11 only the Settings app can install CA certs; other apps get "Can't install CA certificates" ([HTTP Toolkit, Android 11](https://httptoolkit.com/blog/android-11-trust-ca-certificates/); exact menu names vary by vendor, see [Pixel help](https://support.google.com/pixelphone/answer/2844832?hl=en)).
- **Android browser vs app split**: since Android 7, "Apps that target API Level 24 and above no longer trust user or admin-added CAs ... by default" ([Android Developers blog](https://android-developers.googleblog.com/2016/07/changes-to-trusted-certificate.html), [Network security config](https://developer.android.com/privacy-and-security/security-config)). That restriction is per app. Chrome's Android code explicitly enumerates `user:` roots from the Android CA store for its verifier ([Chromium X509Util.java](https://chromium.googlesource.com/chromium/src/+/main/net/android/java/src/org/chromium/net/X509Util.java)), and Chrome's verifier "considers locally-managed certificates" ([Chrome Root Store FAQ](https://chromium.googlesource.com/chromium/src/+/main/net/data/ssl/chrome_root_store/faq.md)), so Chrome trusts a user-installed root. Firefox for Android needs a hidden "use third-party CA certificates" setting and its behavior has varied by version (community reports only, e.g. [support.mozilla.org](https://support.mozilla.org/ca/questions/1358996)). A native Android app (not planned) would need `<certificates src="user"/>` in its own config.

**Carry to v2:** none. Public visitors will not install your root. v2 switches to a public CA anyway.

### B. Real domain + Let's Encrypt DNS-01

Let's Encrypt signs a cert for `ht.home.example.com` after you prove control of the domain with a TXT record. DNS-01 can "validate domain names whose webservers aren't exposed to the public internet" and supports wildcards; it needs a DNS provider with an API, and "Keeping API credentials on your web server is risky", so scope the token narrowly. It "cannot be used to validate IP Addresses", so you need a name ([Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/)). cert-manager has built-in DNS-01 solvers for Cloudflare, Route53, AzureDNS, Google, DigitalOcean and others, plus webhooks for the rest ([cert-manager DNS01](https://cert-manager.io/docs/configuration/acme/dns01/)).

- **Phone setup**: none. Every phone already trusts Let's Encrypt.
- **Renewal**: automatic via cert-manager. Lifetimes are shrinking: 64 days from 2027-02-10, 45 days from 2028-02-16 ([Let's Encrypt: from 90 to 45](https://letsencrypt.org/2025/12/02/from-90-to-45/)). Irrelevant with cert-manager, fatal if you ever renew by hand.
- **Name resolution**: publish a public A record `ht.home.example.com -> 192.168.x.y` (the MetalLB IP). Some routers apply DNS rebinding protection and silently drop public answers pointing to private IPs (community reports, e.g. [Unraid](https://forums.unraid.net/topic/65785-640-error-trying-to-provision-certificate-%E2%80%9Cyour-router-or-dns-provider-has-dns-rebinding-protection-enabled%E2%80%9D/?do=embed), [OpenWrt](https://forum.openwrt.org/t/ddns-allow-private-ip-configuration/88794)). Fixes, in order: whitelist the domain in the router; or set the phone to a public resolver (Android Private DNS, iOS per-Wi-Fi DNS); or run local split-horizon DNS. Test this first from the phone.
- **Costs**: a domain (~$10/year), a DNS API token living in the cluster (input to the secrets-management ticket), and your private IP becomes visible in public DNS (low risk, it is unroutable from outside). Use the Let's Encrypt staging endpoint while experimenting to avoid rate limits ([staging environment](https://letsencrypt.org/docs/staging-environment/)).
- **Carry to v2**: direct. Same domain, same ClusterIssuer, same Certificate objects. Going public just changes where the A record points (cloud load balancer) or puts a tunnel in front. Cloudflare DNS also lines up with Cloudflare Tunnel, one of the v2 candidates.

### Side by side

| | A. Private CA | B. Let's Encrypt DNS-01 |
|---|---|---|
| Phone setup | Install + trust root on every device | None |
| Renewal | mkcert: manual. cert-manager CA: auto leaves, manual root | Auto |
| Survives cluster rebuild | Only if CA Secret is restored | Yes, just re-issues |
| Extra pieces | CA key to guard | Domain, DNS API token, possible router DNS tweak |
| Works without internet | Yes | Issuance/renewal need internet; serving does not |
| v2 carry-over | None | Direct |
| Learning value | PKI internals, trust stores | ACME, DNS, cert-manager as used in production |

## Recommendation

**Option B: cert-manager + Let's Encrypt DNS-01, Cloudflare-hosted domain, MetalLB IP on bridged networking.**

What decided it:

1. **v2 carry-over.** B is the v2 setup already; A is throwaway work you redo when you go public.
2. **No per-device trust hacks.** Installing a root CA on a phone is real friction, gives that root power to intercept all your phone's TLS if the key leaks, and is fiddly on Android.
3. **Rebuild-from-scratch goal.** With B a fresh cluster just re-issues. With A you also have to back up and restore a CA key or re-trust every phone.
4. **Learning value.** cert-manager, ACME and DNS automation are the patterns used in real clusters. A private CA teaches PKI internals, which you can explore later with step-ca if curious.

Accept in exchange: buying a domain, guarding a scoped DNS API token, and maybe one router/phone DNS tweak.

Use mkcert only as a day-zero stopgap if the domain is not ready yet. Do not build on it.

## Open questions

- Is the Windows host on Ethernet or Wi-Fi? On Wi-Fi, MetalLB L2 through VirtualBox's MAC-rewriting bridge needs an early test; if it fails, use the Windows port-forward fallback.
- Does the user already own a domain, and which DNS provider? Cloudflare assumed.
- Does the home router enable DNS rebinding protection? Test by resolving the record from the phone.
- Does the router allow reserving IPs outside the DHCP pool for the MetalLB range?
- The ingress controller choice belongs to #11. Note that ingress-nginx was retired in March 2026 with no further security patches ([Kubernetes blog](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/), [Steering/SRC statement](https://kubernetes.io/blog/2026/01/29/ingress-nginx-statement/)), so pick a maintained controller or Gateway API implementation. cert-manager works with both.
