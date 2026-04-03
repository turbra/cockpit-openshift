# Cockpit Assisted Installer Local

Cockpit plugin for guided OpenShift installation from a local KVM host.

## Purpose

This project explores a Cockpit-hosted install experience similar in spirit to
the Assisted Installer flow, but targeted at local and on-prem deployment from
the hypervisor itself.

Current scope:

- Cockpit-hosted wizard UI
- self-contained local backend
- native installer artifact rendering
- local libvirt storage and domain orchestration
- deploy and clean-rebuild actions
- deployed-cluster discovery and destroy action
- rendered artifact preview and export
- status polling and recent log output from the active job

## Current workflow

The plugin now owns its own local runtime workflow:

- downloads and pins `openshift-install` and `oc`
- renders `install-config.yaml` and `agent-config.yaml`
- generates the agent ISO under its own runtime state
- provisions libvirt disks and domains directly
- waits for `bootstrap-complete` and `install-complete`
- detaches install media and validates the finished cluster

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Cockpit sidebar registration |
| `index.html` | Plugin shell and wizard markup |
| `cockpit-assisted-installer-local.css` | Wizard layout and component styling |
| `cockpit-assisted-installer-local.js` | Wizard state, validation, backend calls, and status polling |
| `installer_backend.py` | Privileged helper that validates requests, renders installer inputs, manages libvirt resources, and drives the install lifecycle |
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

- libvirt and `virt-install` tooling are available on the host
- the selected libvirt storage pool already exists
- the user provides a valid pull secret and SSH public key in the UI, either by pasting them directly or by pointing at local files
- the host can download OpenShift installer and client binaries from the public mirror

The backend currently supports:

- `x86_64`
- static node networking
- SNO (`1` control-plane node) and compact (`3` control-plane nodes)
- directory-backed and logical libvirt storage pools
- optional local performance-domain weighting (`none`, `gold`, `silver`, `bronze`)
- pasted or file-backed pull secret and SSH public key inputs
- no partner-platform integration
- no disconnected flow
- no pull-secret editing in the UI
- no disk-encryption wiring from the UI

Those constraints are explicit backend limits, not hidden defaults.
