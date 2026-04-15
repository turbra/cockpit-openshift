---
title: Capabilities
description: >-
  What Cockpit OpenShift handles well today, what it assumes about the host,
  and where its boundary stops.
summary: >-
  Read this page when you need to decide whether the plugin fits your host,
  topology, and lifecycle expectations before you commit to the local path.
page_type: Capabilities
topic_family: Product shape and decision boundaries
parent_label: Docs Home
parent_url: /
operator_focus:
  - Decide whether a host-local KVM workflow is the right fit.
  - Understand exactly what the backend owns and what it does not.
start_here:
  - label: Practical Use Cases
    url: /practical-use-cases.html
  - label: Reference
    url: /reference.html
related_pages:
  - label: Documentation Map
    url: /documentation-map.html
source_links:
  - label: README.md
    url: https://github.com/turbra/cockpit-openshift/blob/main/README.md
  - label: cockpit-openshift.spec
    url: https://github.com/turbra/cockpit-openshift/blob/main/cockpit-openshift.spec
  - label: src/cockpit-openshift/installer_backend.py
    url: https://github.com/turbra/cockpit-openshift/blob/main/src/cockpit-openshift/installer_backend.py
---

# Capabilities

Cockpit OpenShift is a local install surface for one KVM/libvirt host. It is
not a generic multi-provider installer and it is not trying to hide that fact.

## What It Does Well

- drives OpenShift bring-up from a Cockpit plugin instead of an SSH session
- supports both SNO and compact cluster intent in the UI
- owns the local installer runtime and downloaded binaries
- shows generated installer inputs and plans before the destructive deployment step
- keeps cluster inventory and cluster-specific actions in the same plugin
- exposes rebuild and destroy actions without making the operator reconstruct
  the original shell steps

## What The Backend Owns

The backend is not a thin form submitter. It owns the local workflow:

- installer assets under `/var/lib/cockpit-openshift/`
- generated install artifacts such as:
  - `install-config.yaml`
  - `agent-config.yaml`
  - `static-network-configs.yaml`
  - `guest-plan.yaml`
  - `discovery-plan.yaml`
  - `virt-install-plan.txt`
- libvirt storage and domain creation
- handoff to `openshift-install`, `oc`, `virsh`, and `virt-install`

That matters because the plugin is strongest when you want the host to remain
the source of execution, not just the place where a UI happens to run.

## Supported Path

The supported path today is intentionally narrow:

| Dimension | Current path |
| --- | --- |
| Host | one KVM/libvirt host |
| Topologies | SNO and compact |
| Node networking | static |
| Storage pools | directory-backed and logical pools |
| User-provided inputs | pull secret, SSH public key, DNS, VIPs, node IPs |

> [!IMPORTANT]
> Treat static networking as the supported path. DHCP appears in the UI for
> parity, not because it is already validated end to end.

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
management, or provider-backed automation, that is a different product choice.
