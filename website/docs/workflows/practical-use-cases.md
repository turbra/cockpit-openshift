---
title: Practical Use Cases
description: Operator workflows for local cluster bring-up, review, inventory, rebuild, and teardown.
---

# Practical Use Cases

Use this page when you need to connect the UI to concrete host-side outcomes.

## Bring Up A Local SNO Cluster

Use this when you want a local OpenShift SNO environment on one KVM host without
losing the install logic in a one-off shell session.

1. Open the Cockpit plugin on the host.
2. Choose the single-node control plane shape.
3. Supply cluster identity, pull secret, SSH key, DNS, VIP, and static node
   networking.
4. Review generated `install-config.yaml`, `agent-config.yaml`, guest plan,
   `static-network-configs.yaml`, and the `virt-install` plan.
5. Launch deployment from the same workspace.

The UI preserves the generated installer inputs and keeps the deployment step
tied to the host model that will run it.

## Bring Up A Compact Cluster

Use this when you need a three-control-plane local OpenShift footprint and still
want a guided local workflow.

1. Use the create flow.
2. Select `3` control plane nodes.
3. Set the host sizing and bridge model.
4. Review the generated node plan, discovery plan, and static host networking YAML.
5. Deploy from the final review step.

The plugin keeps cluster intent, generated YAML, and VM plan review in one
operator surface instead of scattering them across local files and terminal
history.

## Review Generated Artifacts

The dangerous part of local OpenShift bring-up is deploying with the wrong
network values, VIPs, or guest shape.

1. Stay in the create workflow until the review step.
2. Inspect rendered `install-config.yaml`.
3. Inspect rendered `agent-config.yaml`.
4. Inspect `static-network-configs.yaml`, the guest plan, and the
   `virt-install` plan.
5. Deploy only after the values match the intended host plan.

The review step turns the plugin into a verification surface, not just a form.

## Return Later To See What Exists

After deployment, use the cluster list in Cockpit to find cluster type, creation
time, version, provider identity, and next actions.

1. Return to the cluster list.
2. Filter the fleet view by name or cluster type.
3. Open the cluster overview page for one cluster.
4. Use the overview details, notices, and actions instead of reconstructing
   state from libvirt manually.

## Rebuild Or Destroy

Local labs and proof-of-concept environments are rebuilt often. Use the same
tool that created the cluster for cleanup.

1. Return to cluster inventory or cluster overview.
2. Choose the destructive action from the plugin.
3. Let the local backend handle the teardown path it already understands.

Creation and cleanup stay in one operational boundary, reducing drift between
the install path and the destroy path.
