# Cockpit Assisted Installer Local

Cockpit plugin prototype for guided OpenShift installation from a local KVM
host.

## Purpose

This project explores a Cockpit-hosted install experience similar in spirit to
the Assisted Installer flow, but targeted at local and on-prem deployment from
the hypervisor itself.

Current scope:

- Cockpit plugin frontend only
- wizard-style OpenShift install page
- local browser-side state and validation
- no deployment backend yet

## Current UI

The current prototype implements the first wizard page:

- `Cluster details`
- step navigation for later stages
- form state for all first-page controls
- required-field validation for cluster name
- disabled `Next` until the first page is valid

Later steps such as host discovery, manifests, and deployment orchestration are
not implemented yet.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Cockpit sidebar registration |
| `index.html` | Plugin shell and wizard markup |
| `cockpit-assisted-installer-local.css` | Wizard layout and component styling |
| `cockpit-assisted-installer-local.js` | Local state and first-page validation |
| `build-rpm.sh` | Builds a noarch Cockpit RPM |
| `cockpit-assisted-installer-local.spec` | RPM packaging metadata |

## Install From Source

```bash
sudo mkdir -p /usr/share/cockpit/cockpit-assisted-installer-local
sudo rsync -av --delete /path/to/cockpit-assisted-installer-local/ /usr/share/cockpit/cockpit-assisted-installer-local/
```

Cockpit discovers the plugin on page load.

## Build RPM

```bash
sudo dnf install -y rpm-build
cd /path/to/cockpit-assisted-installer-local
./build-rpm.sh
```

Build output:

- `rpmbuild/RPMS/noarch/cockpit-assisted-installer-local-*.noarch.rpm`
- `rpmbuild/SRPMS/cockpit-assisted-installer-local-*.src.rpm`

## Feasibility Notes

This is feasible as a standalone Cockpit project without introducing a frontend
build system.

Cockpit plugins can be delivered as:

- `manifest.json`
- static HTML
- static CSS
- plain JavaScript

That is enough for a guided wizard UI. A future backend can be added later
through `cockpit.spawn()` or a dedicated service once the deployment flow is
settled.
