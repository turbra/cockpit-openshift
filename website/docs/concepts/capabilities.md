---
title: Capabilities
description: Supported host model, install shapes, backend ownership, and project boundaries.
---

# Capabilities

Cockpit OpenShift is a local install surface for one KVM/libvirt host. It is
not a generic multi-provider installer and it does not try to hide that boundary.

## What It Does Well

- drives OpenShift bring-up from a Cockpit plugin instead of an SSH session
- supports both SNO and compact cluster intent in the UI
- owns the local installer runtime and downloaded binaries
- shows generated installer inputs and plans before the destructive deployment step
- keeps cluster inventory and cluster-specific actions in the same plugin
- exposes rebuild and destroy actions without making the operator reconstruct
  the original shell steps

## Supported Path

| Dimension | Current path |
| --- | --- |
| Architecture | `x86_64` |
| Host | one KVM/libvirt host |
| Topologies | SNO and compact |
| Node networking | static |
| Storage pools | directory-backed and logical pools |
| User-provided inputs | pull secret, SSH public key, DNS, VIPs, node IPs |

:::important
Treat static networking as the supported path. DHCP appears in the UI for
parity, not because it is already validated end to end.
:::

## What The Backend Owns

The backend owns the local workflow:

- installer assets under `/var/lib/cockpit-openshift/`
- generated install artifacts
- libvirt storage and domain creation
- handoff to `openshift-install`, `oc`, `virsh`, and `virt-install`

This matters because the plugin is strongest when the host remains the source
of execution.

## Where The Boundary Stops

Do not treat the plugin as proof that these are solved:

- remote hypervisor orchestration beyond the local host
- cloud-provider integrations
- day-two host expansion automation
- generic DHCP-driven bring-up
- external GitOps or cluster-fleet lifecycle management

The plugin is about local install execution and local cluster inventory, not a
full OpenShift platform control plane.

## Where This Shape Pays Off

This project is useful when the operator wants:

- fewer shell-driven install steps
- a readable install review step before deployment
- one place to return to after the cluster exists
- a local KVM workflow that still feels deliberate instead of improvised

If the real requirement is hosted Assisted Installer, large-scale fleet
management, or provider-backed automation, use a different product path.
