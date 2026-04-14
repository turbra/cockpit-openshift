---
title: Cockpit OpenShift
description: >-
  Intent-first entry point for the Cockpit-hosted local OpenShift installer on
  one KVM/libvirt host.
summary: >-
  Start here when you need to decide whether this project matches your local
  OpenShift install problem, packaging path, or day-two operator workflow.
page_type: Landing Page
topic_family: Project entry and operator routing
operator_focus:
  - Decide whether the local KVM-host install path fits your environment.
  - Jump straight to use cases, packaging details, or product boundaries.
start_here:
  - label: Documentation Map
    url: /documentation-map.html
  - label: Capabilities
    url: /capabilities.html
  - label: Practical Use Cases
    url: /practical-use-cases.html
  - label: Reference
    url: /reference.html
related_pages:
  - label: Repository README
    url: https://github.com/turbra/cockpit-openshift/blob/main/README.md
source_links:
  - label: README.md
    url: https://github.com/turbra/cockpit-openshift/blob/main/README.md
  - label: src/cockpit-openshift/create.html
    url: https://github.com/turbra/cockpit-openshift/blob/main/src/cockpit-openshift/create.html
  - label: src/cockpit-openshift/index.html
    url: https://github.com/turbra/cockpit-openshift/blob/main/src/cockpit-openshift/index.html
---

<div class="cockpit-openshift-badge-row">
  <a href="https://github.com/turbra/cockpit-openshift/blob/main/LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/github/license/turbra/cockpit-openshift" /></a>
  <img alt="Cockpit plugin" src="https://img.shields.io/badge/Cockpit-plugin-blue" />
  <img alt="OpenShift 4.20" src="https://img.shields.io/badge/OpenShift-4.20-red" />
  <img alt="KVM and libvirt" src="https://img.shields.io/badge/KVM-libvirt-blue" />
  <img alt="RHEL 10" src="https://img.shields.io/badge/RHEL-10-red" />
</div>

Cockpit OpenShift is for operators who want the KVM host itself to drive local
OpenShift bring-up from a Cockpit plugin instead of shelling through
`openshift-install`, `virsh`, and `virt-install` by hand. The project keeps the
install workflow local, shows the generated installer inputs before deployment,
and keeps cluster inventory plus destructive actions in the same UI shell.

## Start Here

<div class="cockpit-openshift-route-grid">
  <section class="cockpit-openshift-route-card">
    <h3>I need to decide if this fits my host and topology</h3>
    <p>Use the capabilities page when you need the supported path, backend boundary, and the places this project stops on purpose.</p>
    <a href="{{ '/capabilities.html' | relative_url }}"><kbd>OPEN CAPABILITIES</kbd></a>
  </section>
  <section class="cockpit-openshift-route-card">
    <h3>I need the actual operator workflow</h3>
    <p>Use the practical use cases page when you care about bringing up SNO or compact clusters, reviewing generated artifacts, and returning later for rebuild or teardown.</p>
    <a href="{{ '/practical-use-cases.html' | relative_url }}"><kbd>OPEN USE CASES</kbd></a>
  </section>
  <section class="cockpit-openshift-route-card">
    <h3>I need commands, files, and packaging details</h3>
    <p>Use the reference page for source install commands, RPM packaging, runtime paths, and the key source files that carry the workflow.</p>
    <a href="{{ '/reference.html' | relative_url }}"><kbd>OPEN REFERENCE</kbd></a>
  </section>
  <section class="cockpit-openshift-route-card">
    <h3>I know the operator problem but not the page</h3>
    <p>Use the documentation map when you want the shortest route from a host-side problem to the right page family.</p>
    <a href="{{ '/documentation-map.html' | relative_url }}"><kbd>OPEN DOCS MAP</kbd></a>
  </section>
</div>

## What The Plugin Covers

- guided local OpenShift SNO and compact cluster creation
- host-local backend for installer downloads, libvirt storage, and VM creation
- rendered `install-config.yaml`, `agent-config.yaml`, host plan, and
  `virt-install` review before deployment
- cluster inventory, cluster overview, and cluster-scoped actions from Cockpit
- rebuild and destroy flows from the same UI surface

## Current Operating Model

The project is opinionated on purpose:

| Layer | Current model |
| --- | --- |
| Host model | one KVM/libvirt host |
| UI shell | Cockpit plugin |
| Backend | privileged local helper |
| Validated install shapes | SNO and compact |
| Networking | static node networking is the supported path |
| Artifact ownership | backend writes under `/var/lib/cockpit-openshift/` |

DHCP is represented in the UI, but it is not the validated path today.

## Workflow Shape

<div class="cockpit-openshift-diagram-card">
  <img alt="Cockpit OpenShift local install workflow diagram" src="{{ '/assets/images/local-install-flow.svg' | relative_url }}" />
  <p>The plugin keeps host preparation, guided input, artifact review, deployment, and post-install inventory in one local operator surface.</p>
</div>

## Operator Screens

<div class="cockpit-openshift-media-grid">
  <div class="cockpit-openshift-media-card">
    <img alt="Cockpit OpenShift install workflow" src="{{ '/assets/images/dashboard-v2.png' | relative_url }}" />
    <p>The guided create flow keeps cluster identity, networking, generated YAML, and deployment review in one workspace.</p>
  </div>
  <div class="cockpit-openshift-media-card">
    <img alt="Cockpit OpenShift fleet view" src="{{ '/assets/images/dashboard-fleet-v2.png' | relative_url }}" />
    <p>The fleet view keeps cluster inventory, cluster type, version, provider, and action routing visible after deployment.</p>
  </div>
</div>

## Why This Exists

This project is not trying to replace the hosted Assisted Installer or become a
generic OpenShift lifecycle manager. It exists for the specific case where the
operator owns one KVM host, wants a local install workflow, and still wants the
install plan, generated inputs, and destructive actions presented in a sharper
UI than a loose shell script stack.

## Repository

The repository remains the source of truth for code, packaging, and this docs
site:

- [Repository](https://github.com/turbra/cockpit-openshift)
- [README](https://github.com/turbra/cockpit-openshift/blob/main/README.md)
