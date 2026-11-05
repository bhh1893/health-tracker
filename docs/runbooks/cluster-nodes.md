# Prepare the cluster nodes

Takes the three nodes from freshly created to "OS ready for kubeadm" (ADR 0004). Step 1 runs on Windows, the rest on the dev VM.

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

kubeadm's own checks must pass:

```
ssh -i ~/.ssh/health-tracker-ops vagrant@192.168.56.10 sudo kubeadm init phase preflight --dry-run
```

Workers' LAN addresses come from the router and can change on reboot. Nothing depends on them.
