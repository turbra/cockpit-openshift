---
title: Source Install
description: Copy-paste source installation commands for the Cockpit plugin.
---

# Source Install

Run these commands from the repository root on the Cockpit host.

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

Start Cockpit if needed:

```bash
sudo systemctl enable --now cockpit.socket
```

Open the plugin at:

```text
https://<host>:9090
```

Navigate to `OpenShift`.

## Installed Files

| File | Mode | Purpose |
| --- | --- | --- |
| `manifest.json` | `0644` | Cockpit menu registration |
| `index.html` | `0644` | cluster inventory entry point |
| `create.html` | `0644` | guided install workflow |
| `overview.html` | `0644` | cluster-specific day-two view |
| `cockpit-openshift.css` | `0644` | plugin styles |
| `cockpit-openshift.js` | `0644` | create-flow UI logic |
| `cluster-list.js` | `0644` | inventory and fleet interactions |
| `cluster-overview.js` | `0644` | cluster overview behavior |
| `installer_backend.py` | `0755` | privileged backend helper |
