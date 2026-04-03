# Cockpit Assisted Installer Local

Cockpit plugin for guided OpenShift installation from a local KVM host.

## Purpose

This project explores a Cockpit-hosted install experience similar in spirit to
the Assisted Installer flow, but targeted at local and on-prem deployment from
the hypervisor itself.

Current scope:

- Cockpit-hosted wizard UI
- local backend that drives the existing `stakkr` OpenShift site playbooks
- deploy and clean-rebuild actions
- status polling and recent log output from the active job

## Current workflow

The plugin currently drives the existing local `stakkr` workflow:

- true SNO through `playbooks/site-openshift-sno.yml`
- compact through `playbooks/site-openshift-compact.yml`
- clean rebuilds through the matching `*-redeploy.yml` wrappers
- rendering of the local-only working files:
  - `vars/cluster/openshift_install_cluster.yml`
  - `vars/guests/openshift_cluster_vm.yml`

The plugin does not invent a separate install lifecycle. It follows the
existing `stakkr` orchestration path and treats that repo as the authoritative
backend.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Cockpit sidebar registration |
| `index.html` | Plugin shell and wizard markup |
| `cockpit-assisted-installer-local.css` | Wizard layout and component styling |
| `cockpit-assisted-installer-local.js` | Wizard state, validation, backend calls, and status polling |
| `installer_backend.py` | Privileged helper that validates requests, renders local-only `stakkr` inputs, and runs Ansible |
| `build-rpm.sh` | Builds a noarch Cockpit RPM |
| `cockpit-assisted-installer-local.spec` | RPM packaging metadata |

## Install From Source

```bash
sudo mkdir -p /usr/share/cockpit/cockpit-assisted-installer-local
sudo install -m 0644 manifest.json /usr/share/cockpit/cockpit-assisted-installer-local/
sudo install -m 0644 index.html /usr/share/cockpit/cockpit-assisted-installer-local/
sudo install -m 0644 cockpit-assisted-installer-local.css /usr/share/cockpit/cockpit-assisted-installer-local/
sudo install -m 0644 cockpit-assisted-installer-local.js /usr/share/cockpit/cockpit-assisted-installer-local/
sudo install -m 0755 installer_backend.py /usr/share/cockpit/cockpit-assisted-installer-local/
```

Cockpit discovers the plugin on page load. The backend helper is invoked through
`cockpit.spawn(..., { superuser: "require" })`.

## Build RPM

```bash
sudo dnf install -y rpm-build
cd /path/to/cockpit-assisted-installer-local
./build-rpm.sh
```

Build output:

- `rpmbuild/RPMS/noarch/cockpit-assisted-installer-local-*.noarch.rpm`
- `rpmbuild/SRPMS/cockpit-assisted-installer-local-*.src.rpm`

## Backend expectations

The plugin assumes:

- the `stakkr` repo already exists on the host
- the repo secrets already exist under `stakkr/secrets/`
- Ansible and `systemd-run` are available on the host
- the user provides a valid vault password file path in the UI

The backend currently supports only the existing local `stakkr` capabilities:

- `x86_64`
- static node networking
- no partner-platform integration
- no disconnected flow
- no pull-secret editing in the UI
- no disk-encryption wiring from the UI

Those constraints are explicit backend limits, not hidden defaults.
