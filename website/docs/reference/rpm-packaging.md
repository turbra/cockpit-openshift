---
title: RPM Packaging
description: Build and install the local Cockpit OpenShift RPM.
---

# RPM Packaging

The repository includes a local RPM build script and spec file.

## Build Requirements

Install `rpm-build` once on the build host:

```bash
sudo dnf install -y rpm-build
```

## Build Command

Run from the project directory:

```bash
cd /path/to/cockpit-openshift
./build-rpm.sh
```

Expected output:

```text
rpmbuild/RPMS/noarch/cockpit-openshift-*.noarch.rpm
rpmbuild/SRPMS/cockpit-openshift-*.src.rpm
```

## Install Command

Install the built package from the project directory:

```bash
sudo dnf install -y ./rpmbuild/RPMS/noarch/cockpit-openshift-0.1.0-1.el10.noarch.rpm
```

The exact dist suffix depends on the build host.

## Packaged Files

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

Install path:

```text
/usr/share/cockpit/cockpit-openshift/
```

## Packaging Source

| Path | Role |
| --- | --- |
| `build-rpm.sh` | creates the source tarball and runs `rpmbuild` |
| `cockpit-openshift.spec` | package metadata and install manifest |
