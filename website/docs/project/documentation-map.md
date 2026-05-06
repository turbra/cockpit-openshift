---
title: Documentation Map
description: Route from an operator problem to the right docs page.
---

# Documentation Map

Use this page when you know what you need to do on the host, but do not yet know
which page carries the workflow or reference detail.

## Reading Model

- use [Capabilities](../concepts/capabilities.md) when you need decision
  boundaries
- use [Practical Use Cases](../workflows/practical-use-cases.md) when you need
  operator workflows and outcome-driven patterns
- use [Reference](../reference/index.md) when you need exact install commands,
  files, runtime paths, and packaging behavior

## Route By Intent

### I need to know whether this plugin is the right tool

1. Read [Capabilities](../concepts/capabilities.md).
2. Return to [Docs Home](../index.mdx) if you need the broader operating model
   and screenshots.

### I need the operator flow for bringing up a cluster locally

1. Read [Practical Use Cases](../workflows/practical-use-cases.md).
2. Read [Reference](../reference/index.md) for exact source install or RPM build
   commands.

### I need packaging and install details right now

1. Read [Source Install](../reference/source-install.md) or
   [RPM Packaging](../reference/rpm-packaging.md).
2. Return to [Practical Use Cases](../workflows/practical-use-cases.md) if you
   need the operator workflow shape.

### I need to understand what the backend owns on the host

1. Read [Runtime Model](../concepts/runtime-model.md).
2. Read [Runtime Files](../reference/runtime-files.md).

### I need to understand the day-two UI after a cluster exists

1. Read [Practical Use Cases](../workflows/practical-use-cases.md).
2. Focus on the fleet and cluster-overview workflows.
