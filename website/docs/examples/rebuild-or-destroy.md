---
title: Rebuild Or Destroy
description: Use the same Cockpit plugin boundary for local cluster cleanup.
---

# Rebuild Or Destroy

Use the plugin for cleanup when the cluster was created by Cockpit OpenShift.
That keeps create, rebuild, and destroy actions inside the same backend
boundary.

## Rebuild

Use rebuild when the local cluster should be recreated with the same operational
context.

1. Open the cluster list or cluster overview.
2. Choose the rebuild action.
3. Confirm that the target cluster is the one you intend to replace.
4. Let the backend run the cleanup and deployment path it owns.

## Destroy

Use destroy when the local cluster should be removed from the host.

1. Open the cluster list or cluster overview.
2. Choose the destroy action.
3. Confirm the destructive action.
4. Return to inventory after cleanup completes.

Do not mix a manual cleanup routine with the plugin path unless you are
intentionally repairing local state.
