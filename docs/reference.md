---
title: Reference
description: >-
  Scan-friendly reference for install commands, RPM packaging, runtime files,
  backend expectations, and source layout.
summary: >-
  Read this page when you need exact commands, file paths, or packaging details
  without digging through the repo.
page_type: Reference
topic_family: Install, packaging, runtime, and source layout
parent_label: Docs Home
parent_url: /
operator_focus:
  - Get exact host commands, paths, files, and packaging details fast.
  - Confirm what artifacts and source files actually drive the workflow.
start_here:
  - label: Practical Use Cases
    url: /practical-use-cases.html
  - label: Capabilities
    url: /capabilities.html
related_pages:
  - label: Documentation Map
    url: /documentation-map.html
source_links:
  - label: README.md
    url: https://github.com/turbra/cockpit-openshift/blob/main/README.md
  - label: build-rpm.sh
    url: https://github.com/turbra/cockpit-openshift/blob/main/build-rpm.sh
  - label: cockpit-openshift.spec
    url: https://github.com/turbra/cockpit-openshift/blob/main/cockpit-openshift.spec
  - label: src/cockpit-openshift/manifest.json
    url: https://github.com/turbra/cockpit-openshift/blob/main/src/cockpit-openshift/manifest.json
---

# Reference

## Host Prerequisites

- Cockpit installed on the KVM host
- libvirt installed and usable on the KVM host
- `virt-install` tooling installed on the KVM host
- a target libvirt storage pool already exists
- outbound access to the OpenShift public mirror for installer downloads
- operator-provided:
  - pull secret
  - SSH public key
  - cluster DNS
  - node IPs and VIPs

## Runtime Model

| Component | Role |
| --- | --- |
| Cockpit plugin | local UI shell |
| `installer_backend.py` | privileged workflow owner |
| `/var/lib/cockpit-openshift/` | backend runtime and generated artifacts |
| `openshift-install` / `oc` / `virsh` / `virt-install` | host-side execution tools |

## Install From Source

```bash
sudo mkdir -p /usr/share/cockpit/cockpit-openshift
sudo install -m 0644 src/cockpit-openshift/manifest.json /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/index.html /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/create.html /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/overview.html /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/cockpit-openshift.css /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/cockpit-openshift.js /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/cluster-list.js /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/cluster-overview.js /usr/share/cockpit/cockpit-openshift/
sudo install -m 0755 src/cockpit-openshift/installer_backend.py /usr/share/cockpit/cockpit-openshift/
```

Then ensure Cockpit is running:

```bash
sudo systemctl enable --now cockpit.socket
```

Cockpit will expose the plugin in the left navigation as `OpenShift`.

## Build The RPM

```bash
sudo dnf install -y rpm-build
cd /path/to/cockpit-openshift
./build-rpm.sh
```

Expected RPM output:

- `rpmbuild/RPMS/noarch/cockpit-openshift-*.noarch.rpm`

## Install The RPM

```bash
sudo dnf install -y ./rpmbuild/RPMS/noarch/cockpit-openshift-1.0.0-1.el10.noarch.rpm
```

## Packaging Notes

The RPM spec currently installs:

- `manifest.json`
- `index.html`
- `create.html`
- `overview.html`
- `cockpit-openshift.js`
- `cluster-list.js`
- `cluster-overview.js`
- `cockpit-openshift.css`
- `installer_backend.py`
- `README.md`

Path:

- `/usr/share/cockpit/cockpit-openshift/`

The backend preview bundle currently exposes these operator-review artifacts:

- `install-config.yaml`
- `agent-config.yaml`
- `static-network-configs.yaml`
- `guest-plan.yaml`
- `discovery-plan.yaml`
- `virt-install-plan.txt`

## Cockpit Entry Point

The Cockpit menu registration lives in:

- `src/cockpit-openshift/manifest.json`

Current menu shape:

- label: `OpenShift`
- path: `index.html`
- keywords include `openshift`, `installer`, `wizard`, `local`, `sno`, and
  `compact`

## Key Source Files

| Path | Why it exists in the workflow |
| --- | --- |
| `src/cockpit-openshift/index.html` | cluster inventory entry point |
| `src/cockpit-openshift/create.html` | guided create/install workflow |
| `src/cockpit-openshift/overview.html` | cluster-specific day-two view |
| `src/cockpit-openshift/cockpit-openshift.js` | main create-flow UI logic |
| `src/cockpit-openshift/cluster-list.js` | inventory and fleet interactions |
| `src/cockpit-openshift/cluster-overview.js` | cluster-overview behavior |
| `src/cockpit-openshift/installer_backend.py` | backend execution boundary |
| `cockpit-openshift.spec` | RPM packaging definition |
| `build-rpm.sh` | local RPM build entrypoint |

## Screens In Scope

- cluster list / fleet management
- create cluster / assisted install workflow
- cluster overview

Tabs like monitoring, access control, support, and add hosts appear in the UI,
but they are not the proven backend-heavy workflows today.
