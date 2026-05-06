---
title: Development
description: Local development notes for the Cockpit OpenShift plugin and docs site.
---

# Development

The repository has two main work areas:

| Path | Purpose |
| --- | --- |
| `src/cockpit-openshift/` | Cockpit plugin runtime assets and backend helper |
| `website/` | Docusaurus documentation site |

## Plugin Development

Install from source when iterating on local plugin files:

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

Cockpit discovers the plugin on page load.

## Documentation Development

Run the Docusaurus dev server from `website/`:

```bash
cd website
npm install
npm run start
```
