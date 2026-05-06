---
title: First Run
description: Run the first local OpenShift install workflow from the Cockpit UI.
---

# First Run

Use this flow after the plugin is installed on the Cockpit host.

## Prepare Inputs

Have these values ready before opening the create flow:

| Input | Notes |
| --- | --- |
| Pull secret | Paste it in the UI or point at a local file on the host |
| SSH public key | Paste it in the UI or point at a local file on the host |
| Cluster DNS | Must already be planned for the local environment |
| Node IPs | Use static node networking for the validated path |
| VIPs | Prepare API and ingress VIPs for the chosen topology |
| Libvirt storage pool | Must already exist |

The pull secret is redacted in the YAML preview.

## Create A Cluster

1. Open `https://<host>:9090`.
2. Navigate to `OpenShift`.
3. Start the create flow.
4. Choose SNO or compact topology.
5. Enter cluster identity, host sizing, storage, networking, pull secret, and
   SSH key values.
6. Review the generated artifacts.
7. Deploy from the final review step.

## Review Before Deploy

The UI previews the artifacts that define the install:

- `install-config.yaml`
- `agent-config.yaml`
- `static-network-configs.yaml`
- `guest-plan.yaml`
- `discovery-plan.yaml`
- `virt-install-plan.txt`

Do not deploy until DNS, VIPs, node IPs, and guest sizing match the host plan.

## Return After Deployment

Use the cluster list to see deployed clusters, cluster type, version, provider,
creation time, and action routing. Open a cluster overview when you need
cluster-scoped details or destructive actions.
