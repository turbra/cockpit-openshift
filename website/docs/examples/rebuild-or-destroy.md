---
title: Reprovision Or Destroy
description: Use the same Cockpit plugin boundary for local cluster cleanup.
---

# Reprovision Or Destroy

Use the plugin for cleanup when the cluster was created by Cockpit OpenShift.
That keeps create, reprovision, and destroy actions inside the same backend
boundary.

## Reprovision

Use reprovision when the local cluster should be destroyed and recreated from
the saved cluster configuration.

1. Open the cluster list or cluster overview.
2. Choose the reprovision action.
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
