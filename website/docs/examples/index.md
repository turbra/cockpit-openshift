---
title: Examples
description: Practical Cockpit OpenShift operator examples.
---

# Examples

Use these examples as task checklists when you are preparing a local host,
reviewing generated artifacts, or cleaning up a local cluster.

| Task | Example |
| --- | --- |
| Bring up one local control-plane node | [SNO local install](sno-local-install.md) |
| Bring up three local control-plane nodes | [Compact local install](compact-local-install.md) |
| Stop before deployment and inspect outputs | [Review generated artifacts](review-generated-artifacts.md) |
| Recreate or remove a local cluster | [Reprovision or destroy](rebuild-or-destroy.md) |

The examples assume static node networking, an existing libvirt storage pool,
prepared DNS, a pull secret, and an SSH public key.
