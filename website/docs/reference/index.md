---
title: Reference
description: Reference index for commands, files, packaging, runtime paths, and source layout.
---

# Reference

Use these pages when you need exact commands, file paths, packaging behavior, or
source ownership.

| Need | Page |
| --- | --- |
| Copy source install commands | [Source Install](source-install.md) |
| Build or inspect RPM packaging | [RPM Packaging](rpm-packaging.md) |
| Confirm runtime paths and generated files | [Runtime Files](runtime-files.md) |
| Find the source file for a workflow area | [Source Layout](source-layout.md) |

## Host Prerequisites

- Cockpit installed on the KVM host
- libvirt installed and usable on the KVM host
- `virt-install` tooling installed on the KVM host
- a target libvirt storage pool already exists
- outbound access to the OpenShift public mirror for installer downloads
- pull secret
- SSH public key
- cluster DNS
- node IPs and VIPs

## Current Constraints

| Area | Current reference value |
| --- | --- |
| RPM version | `0.1.0` |
| OpenShift badge target | `4.21.7` |
| Cockpit path | `/usr/share/cockpit/cockpit-openshift/` |
| Runtime path | `/var/lib/cockpit-openshift/` |
| Validated networking | static node networking |
