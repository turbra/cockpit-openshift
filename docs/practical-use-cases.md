---
title: Practical Use Cases
description: >-
  Operator-facing workflows that connect Cockpit OpenShift to local cluster
  bring-up, review, rebuild, and teardown outcomes.
summary: >-
  Read this page when you want the actual practitioner flows this plugin makes
  easier, not a feature inventory.
page_type: Practical Use Cases
topic_family: Operator workflows and outcomes
parent_label: Docs Home
parent_url: /
operator_focus:
  - Follow the actual host-side workflows the plugin makes easier.
  - Connect the UI to concrete install, review, and cleanup outcomes.
start_here:
  - label: Reference
    url: /reference.html
  - label: Capabilities
    url: /capabilities.html
related_pages:
  - label: Documentation Map
    url: /documentation-map.html
source_links:
  - label: src/cockpit-openshift/create.html
    url: https://github.com/turbra/cockpit-openshift/blob/main/src/cockpit-openshift/create.html
  - label: src/cockpit-openshift/index.html
    url: https://github.com/turbra/cockpit-openshift/blob/main/src/cockpit-openshift/index.html
  - label: src/cockpit-openshift/overview.html
    url: https://github.com/turbra/cockpit-openshift/blob/main/src/cockpit-openshift/overview.html
---

# Practical Use Cases

This page is about when an operator would actually use Cockpit OpenShift on the
host, and why the plugin is better than a loose sequence of commands in that
moment.

## Use Case: Bring Up A Local SNO Cluster Without Losing The Install Plan

Problem:
You want a local OpenShift SNO environment on one KVM host, but you do not want
the install logic to disappear into a one-off shell session.

Pattern:

1. open the Cockpit plugin on the host
2. choose the single-node control plane shape
3. supply cluster identity, pull secret, SSH key, DNS, VIP, and static node
   networking
4. review generated `install-config.yaml`, `agent-config.yaml`, guest plan, and
   `static-network-configs.yaml`, plus the `virt-install` plan before deployment
5. launch deployment from the same workspace

Why this is the right pattern:
The UI preserves the generated installer inputs and keeps the deployment step
tied to the exact host model that will run it.

## Use Case: Bring Up A Compact Cluster On The Same Host Model

Problem:
You need a three-control-plane local OpenShift footprint, but you still want a
guided local workflow instead of manually coordinating VM definitions and
installer inputs.

Pattern:

1. use the create flow
2. select `3` control plane nodes
3. set the host sizing and bridge model
4. review the generated node plan, discovery plan, and static host networking YAML
5. deploy from the final review step

Why this is the right pattern:
The plugin keeps cluster intent, generated YAML, and VM plan review in one
operator surface instead of scattering them across local files and terminal
history.

## Use Case: Review Generated Artifacts Before You Commit To Deployment

Problem:
The dangerous part of local OpenShift bring-up is not opening the UI. It is
deploying with the wrong network values, wrong VIPs, or wrong guest shape.

Pattern:

1. stay in the create workflow until the review step
2. inspect rendered `install-config.yaml`
3. inspect rendered `agent-config.yaml`
4. inspect `static-network-configs.yaml`, the guest plan, and the `virt-install` plan
5. only then allow the deployment

Why this is the right pattern:
The review step turns the plugin into a verification surface, not just a form.

## Use Case: Return Later To See What Exists On The Host

Problem:
After deployment, operators still need an inventory view: cluster type,
creation time, version, provider identity, and the next actions.

Pattern:

1. return to the cluster list in Cockpit
2. filter the fleet view by name or cluster type
3. open the cluster overview page for one cluster
4. use the overview details, notices, and actions instead of reconstructing
   state from libvirt manually

Why this is the right pattern:
The project is not only an installer. It keeps a post-install operator surface.

## Use Case: Clean Rebuild Or Destroy From The Same Tool

Problem:
Local labs and proof-of-concept environments are rebuilt often. The weak path
is running a different, undocumented destroy routine than the one that created
the cluster.

Pattern:

1. return to cluster inventory or cluster overview
2. choose the destructive action from the same plugin
3. let the local backend handle the teardown path it already understands

Why this is the right pattern:
Steady-state creation and cleanup stay in one operational boundary, which
reduces drift between the install path and the destroy path.
