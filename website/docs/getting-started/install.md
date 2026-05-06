---
title: Install
description: Install Cockpit OpenShift from source or from a locally built RPM.
---

# Install

Install Cockpit OpenShift on the KVM/libvirt host that will run the local
OpenShift deployment workflow.

## Prerequisites

- Cockpit is installed on the KVM host
- libvirt is installed and usable on the KVM host
- `virt-install` tooling is installed on the KVM host
- the target libvirt storage pool already exists
- the host can reach the OpenShift public mirror to download installer assets
- the operator has a valid pull secret, SSH public key, cluster DNS, node IPs,
  and VIPs for the chosen topology

Preinstalled `oc` and `openshift-install` binaries are not required. The backend
downloads and pins its own copies under `/var/lib/cockpit-openshift/`.

## From Source

Run these commands from the repository root:

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

Start Cockpit if it is not already running:

```bash
sudo systemctl enable --now cockpit.socket
```

Open `https://<host>:9090` and navigate to `OpenShift`.

## Build The RPM

Install the packaging tool once on the build host:

```bash
sudo dnf install -y rpm-build
```

Build from the project directory:

```bash
cd /path/to/cockpit-openshift
./build-rpm.sh
```

Build output:

```text
rpmbuild/RPMS/noarch/cockpit-openshift-*.noarch.rpm
```

## From RPM

Install the built package from the project directory:

```bash
sudo dnf install -y ./rpmbuild/RPMS/noarch/cockpit-openshift-0.1.0-1.el10.noarch.rpm
```

The exact dist suffix depends on the build host.

## Plugin Entry

Cockpit discovers the plugin on page load. If the plugin files are installed
under `/usr/share/cockpit/cockpit-openshift/`, the Cockpit navigation exposes it
as `OpenShift`.
