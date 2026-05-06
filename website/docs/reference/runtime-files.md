---
title: Runtime Files
description: Runtime paths, generated artifacts, and backend-owned state.
---

# Runtime Files

The backend writes runtime state and generated artifacts under:

```text
/var/lib/cockpit-openshift/
```

## Review Artifacts

The backend preview bundle currently exposes these operator-review artifacts:

| Artifact | Purpose |
| --- | --- |
| `install-config.yaml` | OpenShift install configuration |
| `agent-config.yaml` | agent-based installer host configuration |
| `static-network-configs.yaml` | static host network configuration |
| `guest-plan.yaml` | planned guest shape |
| `discovery-plan.yaml` | discovery and host mapping plan |
| `virt-install-plan.txt` | generated `virt-install` execution plan |

## Tooling

The backend coordinates these host-side tools:

- `openshift-install`
- `oc`
- `virsh`
- `virt-install`

The backend downloads and pins its own OpenShift installer and client binaries
under the project runtime path.
