#!/usr/bin/env bash
# Dev VM bootstrap, the cloud-init equivalent (ADR 0009). Runs as root.
# Only what Ansible needs before it can run. Anything else goes in dev.yml.
# Safe to re-run: `vagrant up --provision` must not replace an existing key.
set -euo pipefail

home=/home/vagrant

export DEBIAN_FRONTEND=noninteractive
# First boot: unattended-upgrades may hold the apt lock, so wait instead of failing.
apt-get -o DPkg::Lock::Timeout=300 update
apt-get -o DPkg::Lock::Timeout=300 install -y ansible-core

# The ops key was uploaded by Vagrant's file provisioner. SSH refuses a private
# key that other users can read.
chown vagrant:vagrant "$home/.ssh/health-tracker-ops"
chmod 600 "$home/.ssh/health-tracker-ops"

# Per-machine GitHub key, so this VM can be revoked alone. No passphrase: long
# tmux and Claude sessions must be able to push unattended.
if [ ! -f "$home/.ssh/id_ed25519" ]; then
  sudo -u vagrant ssh-keygen -q -t ed25519 -N "" \
    -C "health-tracker dev VM" -f "$home/.ssh/id_ed25519"
fi
