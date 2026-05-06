---
title: Review Generated Artifacts
description: Inspect generated installer inputs before deployment.
---

# Review Generated Artifacts

Use the review step to catch incorrect networking, VIPs, storage, or guest
sizing before deployment starts.

## Artifacts To Check

| Artifact | Check |
| --- | --- |
| `install-config.yaml` | cluster identity, base domain, networking, pull secret redaction |
| `agent-config.yaml` | host entries and installer host configuration |
| `static-network-configs.yaml` | node IPs, routes, DNS, and interface mapping |
| `guest-plan.yaml` | planned guest names, sizing, disks, and storage pool |
| `discovery-plan.yaml` | discovery and host mapping values |
| `virt-install-plan.txt` | VM creation command plan |

## Deploy Gate

Deploy only after these values match the prepared host plan:

- API VIP
- ingress VIP
- node IPs
- DNS values
- bridge and interface names
- guest CPU, memory, and disk settings
