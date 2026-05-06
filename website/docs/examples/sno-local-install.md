---
title: SNO Local Install
description: Checklist for bringing up a local OpenShift SNO cluster.
---

# SNO Local Install

Use this checklist when you want a single-node OpenShift cluster on one
KVM/libvirt host.

## Before You Start

- Cockpit is running on the host
- libvirt and `virt-install` are available
- the target storage pool exists
- DNS, API VIP, ingress VIP, and node IP are prepared
- pull secret and SSH public key are available

## Create Flow

1. Open `https://<host>:9090`.
2. Navigate to `OpenShift`.
3. Start the create flow.
4. Choose the single-node topology.
5. Enter cluster identity, host sizing, storage, bridge, VIPs, and static node
   networking.
6. Review the generated artifacts.
7. Deploy from the final review step.

## Review Points

- `install-config.yaml` has the expected cluster name, base domain, and pull
  secret redaction in the preview
- `agent-config.yaml` reflects the intended single-node host
- `static-network-configs.yaml` matches the prepared node IP and DNS values
- `virt-install-plan.txt` matches the intended storage and bridge settings
