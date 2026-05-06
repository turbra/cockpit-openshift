---
title: Runtime Model
description: How Cockpit, the backend helper, installer assets, and libvirt tools fit together.
---

# Runtime Model

Cockpit OpenShift runs as a Cockpit plugin with a privileged backend helper on
the same host that owns the KVM/libvirt deployment.

## Components

| Component | Role |
| --- | --- |
| Cockpit plugin | local UI shell |
| `installer_backend.py` | privileged workflow owner |
| `/var/lib/cockpit-openshift/` | backend runtime and generated artifacts |
| `openshift-install` | OpenShift installer execution |
| `oc` | OpenShift client operations used by the backend |
| `virsh` | libvirt domain operations |
| `virt-install` | VM creation flow |

## Artifact Ownership

The backend writes its own runtime state under `/var/lib/cockpit-openshift/`.
Generated artifacts are owned by this project, not by an external orchestration
repository.

The review bundle currently includes:

- `install-config.yaml`
- `agent-config.yaml`
- `static-network-configs.yaml`
- `guest-plan.yaml`
- `discovery-plan.yaml`
- `virt-install-plan.txt`

## Secret Handling

The operator must provide a valid pull secret and SSH public key in the UI,
either by pasting them directly or by pointing at local files on the host. The
pull secret is redacted in the YAML preview.

## Execution Boundary

The plugin does not replace `openshift-install`, `oc`, `virsh`, or
`virt-install`. It coordinates those tools from a Cockpit workflow and keeps the
review and lifecycle state visible to the operator.
