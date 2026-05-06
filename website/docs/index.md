---
title: Cockpit OpenShift
description: Cockpit-hosted local OpenShift installer for one KVM/libvirt host.
slug: /
---

# Cockpit OpenShift

`cockpit-openshift` is a Cockpit plugin for guided OpenShift SNO and compact
cluster deployment on one KVM/libvirt host. The plugin keeps host inputs,
generated installer artifacts, VM plans, deployment status, and post-install
inventory in one local operator surface.

<div className="badge-row">
  <a href="https://github.com/turbra/cockpit-openshift/blob/main/LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/github/license/turbra/cockpit-openshift" /></a>
  <img alt="OpenShift 4.21.7" src="https://img.shields.io/badge/OpenShift-4.21.7-red" />
  <img alt="Cockpit plugin" src="https://img.shields.io/badge/Cockpit-plugin-blue" />
  <img alt="KVM and libvirt" src="https://img.shields.io/badge/KVM-libvirt-blue" />
  <img alt="RHEL 10" src="https://img.shields.io/badge/RHEL-10-red" />
</div>

## Start Here

| Need | Page |
| --- | --- |
| Install the plugin | [Install](getting-started/install.md) |
| Run the first local workflow | [First Run](getting-started/first-run.md) |
| Confirm supported host and topology boundaries | [Capabilities](concepts/capabilities.md) |
| Follow practical operator flows | [Practical Use Cases](workflows/practical-use-cases.md) |
| Find commands, files, and packaging behavior | [Reference](reference/index.md) |

:::important
The validated deployment path today is `x86_64`, static node networking, SNO
with one control-plane node, compact with three control-plane nodes, and
directory-backed or logical libvirt storage pools.
:::

:::note
DHCP is modeled in the UI, but it is not yet validated. Treat static node
networking as the supported path until DHCP is proven end to end.
:::

## Choose An Install Path

Cockpit OpenShift is installed on the host that will run the local KVM/libvirt
workflow. Use the RPM path when you want a package-managed install. Use the
source path when you are iterating on the plugin files directly.

| Path | Use it when | Details |
| --- | --- | --- |
| RPM | you want the normal packaged install path | [Build and install the RPM](getting-started/install.md#build-the-rpm) |
| Source | you are developing or testing local plugin changes | [Install from source](getting-started/install.md#from-source) |

After installation, start Cockpit if needed, open `https://<host>:9090`, and
navigate to `OpenShift`.

## Operating Model

| Layer | Current model |
| --- | --- |
| Host model | one KVM/libvirt host |
| UI shell | Cockpit plugin |
| Backend | privileged local helper |
| Validated install shapes | SNO and compact |
| Networking | static node networking |
| Runtime path | `/var/lib/cockpit-openshift/` |

## Workflow Shape

The workflow keeps host preparation, guided input, artifact review, deployment,
and post-install inventory in one local operator surface.

<div className="workflow-rail">
  <section className="workflow-step">
    <div className="workflow-node">01</div>
    <h3>Prepare</h3>
    <p>Confirm Cockpit, libvirt, storage, DNS, pull secret, SSH key, node IPs, and VIPs.</p>
    <strong>Host and input model ready</strong>
  </section>
  <section className="workflow-step">
    <div className="workflow-node">02</div>
    <h3>Create</h3>
    <p>Choose SNO or compact topology, then enter cluster identity and static networking.</p>
    <strong>Cluster intent captured</strong>
  </section>
  <section className="workflow-step">
    <div className="workflow-node">03</div>
    <h3>Review</h3>
    <p>Inspect installer YAML, guest plan, discovery plan, and the generated `virt-install` plan.</p>
    <strong>Generated artifacts verified</strong>
  </section>
  <section className="workflow-step">
    <div className="workflow-node">04</div>
    <h3>Deploy</h3>
    <p>Launch from Cockpit, track status, return to inventory, rebuild, or destroy.</p>
    <strong>Cluster state tracked</strong>
  </section>
</div>

## Operator Screens

<div className="screenshot-grid">
  <figure>
    <img src={require('./assets/dashboard-v2.png').default} alt="Cockpit OpenShift install workflow" />
    <figcaption>The create flow keeps cluster identity, networking, generated YAML, and deployment review in one workspace.</figcaption>
  </figure>
  <figure>
    <img src={require('./assets/dashboard-fleet-v2.png').default} alt="Cockpit OpenShift fleet view" />
    <figcaption>The fleet view keeps cluster inventory, cluster type, version, provider, and action routing visible after deployment.</figcaption>
  </figure>
</div>

## What The Plugin Covers

- guided OpenShift SNO deployment
- guided OpenShift compact deployment
- self-contained local backend for installer artifacts, libvirt storage, and
  domain creation
- rendered `install-config.yaml`, `agent-config.yaml`, guest plan, and
  `virt-install` plan review
- deployment status, recent output, and deployed-cluster inventory
- clean rebuild and destroy actions from the UI

## Repository

- [Repository](https://github.com/turbra/cockpit-openshift)
- [README](https://github.com/turbra/cockpit-openshift/blob/main/README.md)
