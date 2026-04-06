# Cockpit OpenShift

`cockpit-openshift` is a Cockpit-hosted installer for local OpenShift clusters
and host-based MicroShift deployments.

[![License: GPL-3.0](https://img.shields.io/github/license/turbra/cockpit-openshift)](LICENSE)
![OpenShift 4.20](https://img.shields.io/badge/OpenShift-4.20-red)
![Cockpit](https://img.shields.io/badge/Cockpit-plugin-blue)
![KVM/libvirt](https://img.shields.io/badge/KVM-libvirt-blue)
![RHEL 10](https://img.shields.io/badge/RHEL-10-red)

- guided OpenShift SNO deployment
- guided OpenShift compact deployment
- guided MicroShift deployment to an existing RHEL host over SSH
- self-contained local backend for installer artifacts, libvirt storage, and
  domain creation
- rendered `install-config.yaml`, `agent-config.yaml`, guest plan, and
  `virt-install` plan review
- rendered `config.yaml` and remote install plan review for MicroShift
- deployment status, recent output, and deployed-cluster inventory
- clean rebuild and destroy actions from the UI

## Start Here

- install the plugin from source:
  [commands](#from-source)
- review host prerequisites:
  [notes](#prerequisites)
- build the RPM:
  [commands](#building-the-rpm)
- install the plugin from RPM:
  [commands](#from-rpm)
- backend limits and host expectations:
  [notes](#backend-expectations)

> [!IMPORTANT]
> The validated deployment path today is:
>
> - `x86_64`
> - static node networking
> - SNO (`1` control-plane node)
> - compact (`3` control-plane nodes)
> - directory-backed and logical libvirt storage pools

> [!NOTE]
> DHCP is modeled in the UI, but it is not yet validated. Treat static node
> networking as the supported path until DHCP is proven end to end.

> [!NOTE]
> The user must provide a valid pull secret and SSH public key in the UI,
> either by pasting them directly or by pointing at local files on the host.

> [!NOTE]
> The MicroShift path is intentionally separate from the OpenShift cluster
> workflow. It follows the documented Red Hat Build of MicroShift RPM-based
> install model on an existing RHEL host.

## Default Operating Model

- host-local Cockpit plugin with privileged backend helper
- installer runtime under `/var/lib/cockpit-openshift/`
- generated artifacts owned by this project, not an external orchestration repo
- OpenShift lifecycle driven directly by:
  - `openshift-install`
  - `oc`
  - `virsh`
  - `virt-install`

Use this path when you want the KVM host to drive OpenShift deployment from the
Cockpit UI instead of manually running shell commands.

## Prerequisites

- Cockpit is installed on the KVM host
- libvirt is installed and usable on the KVM host
- `virt-install` tooling is installed on the KVM host
- the target libvirt storage pool already exists
- the host can reach the OpenShift public mirror to download installer assets
- the user has:
  - a valid pull secret
  - an SSH public key
  - cluster DNS prepared
  - node IPs and VIPs prepared for the chosen topology

> [!NOTE]
> Preinstalled `oc` and `openshift-install` binaries are not required. The
> backend downloads and pins its own copies under
> `/var/lib/cockpit-openshift/`.

## Installation

### From source

```bash
sudo mkdir -p /usr/share/cockpit/cockpit-openshift
sudo install -m 0644 src/cockpit-openshift/manifest.json /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/index.html /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/create.html /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/microshift.html /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/overview.html /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/cockpit-openshift.css /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/cockpit-openshift.js /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/microshift.js /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/cluster-list.js /usr/share/cockpit/cockpit-openshift/
sudo install -m 0644 src/cockpit-openshift/cluster-overview.js /usr/share/cockpit/cockpit-openshift/
sudo install -m 0755 src/cockpit-openshift/installer_backend.py /usr/share/cockpit/cockpit-openshift/
sudo install -m 0755 src/cockpit-openshift/microshift_backend.py /usr/share/cockpit/cockpit-openshift/
```

Cockpit discovers the plugin on page load. No service restart is required.

Open Cockpit if it is not already running:

```bash
sudo systemctl enable --now cockpit.socket
```

Then open `https://<host>:9090` and navigate to `OpenShift Install`.

### Building the RPM

Install the packaging tool once on the build host:

```bash
sudo dnf install -y rpm-build
```

Then build from the project directory:

```bash
cd /path/to/cockpit-openshift
./build-rpm.sh
```

Build output:

- `rpmbuild/RPMS/noarch/cockpit-openshift-*.noarch.rpm`

### From RPM

After the RPM has been built, install it from the project directory:

```bash
sudo dnf install -y ./rpmbuild/RPMS/noarch/cockpit-openshift-1.0.0-1.el10.noarch.rpm
```

## Backend Expectations

- libvirt and `virt-install` tooling are available on the host
- the selected libvirt storage pool already exists
- the host can download OpenShift installer and client binaries from the public
  mirror
- the user supplies valid cluster networking, VIPs, and node IPs in the UI
- the backend writes its own runtime state under
  `/var/lib/cockpit-openshift/`
- the current validated path assumes static node networking for cluster bring-up
- the MicroShift path assumes an existing RHEL 9 or RHEL 10 host that is
  reachable over SSH with passwordless sudo and already has access to the
  required package repositories

> [!NOTE]
> The plugin previews generated installer inputs and VM plans directly in the
> UI. The pull secret is redacted in the YAML preview.

## Project Layout

- `src/cockpit-openshift/`
  - Cockpit runtime assets and backend helper
- `docs/microshift-support.md`
  - MicroShift architecture notes, reference mapping, and known gaps
- `build-rpm.sh`
  - local RPM build entrypoint
- `cockpit-openshift.spec`
  - RPM packaging metadata
- `README.md`
  - operator-facing usage and install notes
