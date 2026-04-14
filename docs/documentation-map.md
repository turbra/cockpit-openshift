---
title: Documentation Map
description: >-
  Intent-first routing page for the Cockpit OpenShift docs set.
summary: >-
  Use this page when you know the operator problem but not yet the right page.
page_type: Routing Page
topic_family: Documentation system and reading order
parent_label: Docs Home
parent_url: /
operator_focus:
  - Route from an operator problem to the correct page family quickly.
  - Avoid treating the entire site like one long README.
start_here:
  - label: Capabilities
    url: /capabilities.html
  - label: Practical Use Cases
    url: /practical-use-cases.html
  - label: Reference
    url: /reference.html
related_pages:
  - label: Docs Home
    url: /
source_links:
  - label: docs/index.md
    url: https://github.com/turbra/cockpit-openshift/blob/main/docs/index.md
  - label: README.md
    url: https://github.com/turbra/cockpit-openshift/blob/main/README.md
---

# Documentation Map

Use this page when you know what you need to do on the host, but you do not yet
know which page carries the useful workflow or reference details.

## Reading Model

The docs are split on purpose:

- use a **capabilities** page when you need decision boundaries
- use a **practical use cases** page when you need operator workflows and
  outcome-driven patterns
- use the **reference** page when you need exact install commands, files,
  runtime paths, and packaging behavior

That keeps the site from collapsing into one long README clone.

## Route By Intent

### I need to know whether this plugin is the right tool

1. [Capabilities]({{ '/capabilities.html' | relative_url }})
2. return to [Docs Home]({{ '/' | relative_url }}) if you need the broader
   operating model and screenshots

### I need the operator flow for bringing up a cluster locally

1. [Practical Use Cases]({{ '/practical-use-cases.html' | relative_url }})
2. then jump to [Reference]({{ '/reference.html' | relative_url }}) for exact
   source install or RPM build commands

### I need packaging and install details right now

1. [Reference]({{ '/reference.html' | relative_url }})
2. then return to [Practical Use Cases]({{ '/practical-use-cases.html' | relative_url }})
   if you need the operator-facing workflow shape

### I need to understand what the backend owns on the host

1. [Capabilities]({{ '/capabilities.html' | relative_url }})
2. [Reference]({{ '/reference.html' | relative_url }})

### I need to understand the day-two UI after a cluster exists

1. [Practical Use Cases]({{ '/practical-use-cases.html' | relative_url }})
2. focus on the fleet and cluster-overview workflows

## Main Page Types

- [Capabilities]({{ '/capabilities.html' | relative_url }})
  for product shape, supported path, backend ownership, and hard boundaries
- [Practical Use Cases]({{ '/practical-use-cases.html' | relative_url }})
  for concrete operator outcomes: local install, review, inventory, rebuild,
  and destroy
- [Reference]({{ '/reference.html' | relative_url }})
  for packaging, runtime files, commands, artifact names, and source layout

## Repository Path

- [Repository](https://github.com/turbra/cockpit-openshift)
- [Top README](https://github.com/turbra/cockpit-openshift/blob/main/README.md)
