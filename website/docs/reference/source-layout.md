---
title: Source Layout
description: Source files and what each one owns in the workflow.
---

# Source Layout

Use this page when you need to find the source file for a workflow area.

| Path | Why it exists |
| --- | --- |
| `src/cockpit-openshift/index.html` | cluster inventory entry point |
| `src/cockpit-openshift/create.html` | guided create/install workflow |
| `src/cockpit-openshift/overview.html` | cluster-specific day-two view |
| `src/cockpit-openshift/cockpit-openshift.js` | main create-flow UI logic |
| `src/cockpit-openshift/cluster-list.js` | inventory and fleet interactions |
| `src/cockpit-openshift/cluster-overview.js` | cluster-overview behavior |
| `src/cockpit-openshift/installer_backend.py` | backend execution boundary |
| `cockpit-openshift.spec` | RPM packaging definition |
| `build-rpm.sh` | local RPM build entrypoint |
| `website/` | Docusaurus documentation site |

## Cockpit Entry Point

The Cockpit menu registration lives in:

```text
src/cockpit-openshift/manifest.json
```

Current menu shape:

- label: `OpenShift`
- path: `index.html`
- keywords include `openshift`, `installer`, `wizard`, `local`, `sno`, and
  `compact`

## Screens In Scope

- cluster list and fleet management
- create cluster and assisted install workflow
- cluster overview

Tabs like monitoring, access control, support, and add hosts appear in the UI,
but they are not the proven backend-heavy workflows today.
