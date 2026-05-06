---
title: Compact Local Install
description: Checklist for bringing up a compact OpenShift cluster on one host.
---

# Compact Local Install

Use this checklist when you want three control-plane nodes on the same local
KVM/libvirt host model.

## Before You Start

- the host has enough CPU, memory, and storage for three control-plane guests
- the libvirt storage pool already exists
- static node IPs are prepared for each guest
- DNS, API VIP, and ingress VIP are prepared
- pull secret and SSH public key are available

## Create Flow

1. Open the Cockpit `OpenShift` page.
2. Start the create flow.
3. Choose the compact topology.
4. Enter cluster identity, host sizing, storage, bridge, VIPs, and static node
   networking for all three nodes.
5. Review generated YAML, guest plan, discovery plan, and `virt-install` plan.
6. Deploy from the final review step.

## Review Points

- all three control-plane nodes appear in the generated host plan
- each node has the intended static networking values
- VIPs do not collide with node IPs
- guest sizing matches the host capacity you intend to allocate
