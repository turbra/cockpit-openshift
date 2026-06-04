"use strict";

/* global cockpit */

var HELPER_PATH = "/usr/share/cockpit/cockpit-openshift/installer_backend.py";
var QUICK_COMMAND_TIMEOUT_MS = 30000;
var HEAVY_COMMAND_TIMEOUT_MS = 120000;
var refs = {};
var state = {
    cluster: null,
    status: null,
    activeTab: "overview",
    pendingDestroy: false,
    pendingReprovision: false,
    pageAlert: null,
    loadingCount: 0,
    loadingMessage: ""
};

function backendCommandTimeout(command) {
    return command === "artifacts" || command === "preflight" || command === "start" || command === "destroy" || command === "reprovision"
        ? HEAVY_COMMAND_TIMEOUT_MS
        : QUICK_COMMAND_TIMEOUT_MS;
}

function loadingMessageFor(command) {
    if (command === "clusters") {
        return "Refreshing cluster details...";
    }
    if (command === "destroy") {
        return "Starting destroy...";
    }
    if (command === "reprovision") {
        return "Starting reprovision...";
    }
    return "Contacting backend...";
}

function renderLoadingState() {
    if (!refs.refresh) {
        return;
    }
    refs.refresh.disabled = state.loadingCount > 0;
    refs.refresh.textContent = state.loadingCount > 0 ? "Refreshing" : "Refresh";
    refs.refresh.classList.toggle("is-loading", state.loadingCount > 0);
    if (refs.actionsButton) {
        refs.actionsButton.disabled = state.loadingCount > 0;
    }
}

function beginLoading(command, options) {
    if (options && options.silentLoading) {
        return;
    }
    state.loadingCount += 1;
    state.loadingMessage = loadingMessageFor(command);
    renderLoadingState();
}

function endLoading(options) {
    if (options && options.silentLoading) {
        return;
    }
    state.loadingCount = Math.max(0, state.loadingCount - 1);
    if (state.loadingCount === 0) {
        state.loadingMessage = "";
    }
    renderLoadingState();
}

function backendCommand(command, extraArgs, options) {
    var args = ["python3", HELPER_PATH, command];
    var proc;
    var timeoutId;
    var timedOut = false;
    if (extraArgs && extraArgs.length) {
        args = args.concat(extraArgs);
    }
    beginLoading(command, options);
    proc = cockpit.spawn(args, { superuser: "require", err: "message" });
    return new Promise(function (resolve, reject) {
        timeoutId = window.setTimeout(function () {
            timedOut = true;
            if (proc && typeof proc.close === "function") {
                proc.close("terminated");
            }
            reject(new Error(command + " timed out after " + Math.round(backendCommandTimeout(command) / 1000) + " seconds."));
        }, backendCommandTimeout(command));
        proc.then(function (output) {
            if (timedOut) {
                return;
            }
            window.clearTimeout(timeoutId);
            resolve(JSON.parse(output));
        }).catch(function (error) {
            if (timedOut) {
                return;
            }
            window.clearTimeout(timeoutId);
            reject(error);
        });
    }).finally(function () {
        endLoading(options);
    });
}

function queryClusterId() {
    var params = new URLSearchParams(window.location.search);
    return params.get("clusterId") || "";
}

function formatDate(value) {
    if (!value) {
        return "Not recorded";
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString();
}

function formatMemory(memoryMb, nodeCount) {
    if (!memoryMb) {
        return "Not recorded";
    }
    var totalGiB = (memoryMb * Math.max(nodeCount, 1) / 1024).toFixed(1);
    return totalGiB + " GiB total (" + memoryMb + " MiB per node)";
}

function formatVcpus(vcpus, nodeCount) {
    if (!vcpus) {
        return "Not recorded";
    }
    return String(vcpus * Math.max(nodeCount, 1)) + " total (" + vcpus + " per node)";
}

function clusterIdFromRequest(request) {
    if (!request || !request.clusterName || !request.baseDomain) {
        return "";
    }
    return request.clusterName + "." + request.baseDomain;
}

function clusterStatus(cluster, status) {
    if (status && status.running && cluster.clusterId === clusterIdFromRequest(status.request)) {
        return "Deploying";
    }
    if (cluster.synthetic) {
        if (status && status.state && status.state.status === "failed") {
            return "Failed";
        }
        if (status && status.state && status.state.status === "succeeded") {
            return "Installed";
        }
        return "Provisioning";
    }
    if (!cluster.health) {
        return "Unknown";
    }
    if (cluster.health.available) {
        return "Available";
    }
    if (cluster.health.apiReachable) {
        return "API reachable";
    }
    if (cluster.nodeCount > 0) {
        return "Provisioning";
    }
    return "Detected";
}

function buildSyntheticCluster(status) {
    var request = status.request;
    var clusterId = clusterIdFromRequest(request);
    if (!request || !clusterId || (status.state && status.state.mode === "destroy")) {
        return null;
    }
    return {
        clusterId: clusterId,
        clusterName: request.clusterName,
        baseDomain: request.baseDomain,
        topology: request.topology || "compact",
        nodeCount: request.hosts ? request.hosts.length : 0,
        consoleUrl: "https://console-openshift-console.apps." + clusterId,
        kubeconfigPath: "",
        createdAt: request.createdAt || "",
        owner: request.owner || "local-admin",
        openshiftVersion: request.openshiftVersion || "",
        openshiftRelease: request.openshiftRelease || "",
        provider: request.provider || "Local libvirt / KVM",
        region: request.region || "Local KVM host",
        channelGroup: request.channelGroup || "",
        partnerIntegration: request.partnerIntegration || "No platform integration",
        nodeVcpus: request.compute ? request.compute.nodeVcpus : 0,
        memoryMb: request.compute ? request.compute.nodeMemoryMb : 0,
        operators: request.operators || [],
        health: {
            available: false,
            apiReachable: false,
            readyNodes: 0,
            totalNodes: request.hosts ? request.hosts.length : 0,
            message: ""
        },
        synthetic: true,
        currentTask: status.currentTask || ""
    };
}

function resolveCluster(clustersResult, status) {
    var clusterId = queryClusterId();
    var clusters = clustersResult.clusters || [];
    var cluster = clusters.find(function (entry) { return entry.clusterId === clusterId; });
    if (cluster) {
        cluster.synthetic = false;
        cluster.currentTask = status.running && cluster.clusterId === clusterIdFromRequest(status.request) ? (status.currentTask || "") : "";
        return cluster;
    }
    cluster = buildSyntheticCluster(status);
    if (cluster && cluster.clusterId === clusterId) {
        return cluster;
    }
    return null;
}

function renderKeyValueList(container, rows) {
    container.innerHTML = "";
    rows.forEach(function (row) {
        var dt = document.createElement("dt");
        var dd = document.createElement("dd");
        dt.textContent = row[0];
        dd.textContent = row[1];
        container.appendChild(dt);
        container.appendChild(dd);
    });
}

function renderList(container, items) {
    if (!container) {
        return;
    }
    container.innerHTML = "";
    items.forEach(function (item) {
        var li = document.createElement("li");
        li.textContent = item;
        container.appendChild(li);
    });
}

function renderTabs() {
    refs.tabs.forEach(function (button) {
        var active = button.dataset.tab === state.activeTab;
        button.classList.toggle("overview-tabs__tab--active", active);
        button.toggleAttribute("aria-current", active);
    });
    Object.keys(refs.panels).forEach(function (key) {
        refs.panels[key].hidden = key !== state.activeTab;
    });
}

function closeActionsMenu() {
    refs.actionsMenu.hidden = true;
    refs.actionsButton.setAttribute("aria-expanded", "false");
}

function openActionsMenu() {
    refs.actionsMenu.hidden = false;
    refs.actionsButton.setAttribute("aria-expanded", "true");
}

function showPageAlert(message, type, title) {
    state.pageAlert = {
        title: title || (type === "danger" ? "Action failed" : "Notice"),
        message: message,
        type: type || "info"
    };
    renderPageAlert();
}

function clearPageAlert() {
    state.pageAlert = null;
    renderPageAlert();
}

function renderPageAlert() {
    var alert;
    var copy;
    var title;
    var body;
    var close;

    refs.pageAlertRoot.innerHTML = "";
    if (!state.pageAlert) {
        return;
    }

    alert = document.createElement("div");
    copy = document.createElement("div");
    title = document.createElement("div");
    body = document.createElement("div");
    close = document.createElement("button");

    alert.className = "page-alert page-alert--" + state.pageAlert.type;
    alert.setAttribute("role", state.pageAlert.type === "danger" ? "alert" : "status");
    title.className = "page-alert__title";
    title.textContent = state.pageAlert.title;
    body.className = "page-alert__body";
    body.textContent = state.pageAlert.message;
    close.type = "button";
    close.className = "page-alert__close";
    close.setAttribute("aria-label", "Dismiss alert");
    close.textContent = "x";
    close.addEventListener("click", clearPageAlert);

    copy.appendChild(title);
    copy.appendChild(body);
    alert.appendChild(copy);
    alert.appendChild(close);
    refs.pageAlertRoot.appendChild(alert);
}

function requestDestroyCluster() {
    state.pendingDestroy = true;
    state.pendingReprovision = false;
    renderConfirmation();
}

function requestReprovisionCluster() {
    state.pendingReprovision = true;
    state.pendingDestroy = false;
    renderConfirmation();
}

function cancelClusterAction() {
    state.pendingDestroy = false;
    state.pendingReprovision = false;
    renderConfirmation();
}

function confirmDestroyCluster() {
    var cluster = state.cluster;
    if (!cluster) {
        return;
    }
    state.pendingDestroy = false;
    renderConfirmation();
    backendCommand("destroy", ["--cluster-id", cluster.clusterId]).then(function (result) {
        if (!result.ok) {
            showPageAlert((result.errors || ["Cluster destroy failed."]).join(" "), "danger", "Cluster destroy failed");
            return;
        }
        window.location.href = "index.html";
    }).catch(function (error) {
        showPageAlert(String(error), "danger", "Cluster destroy failed");
    });
}

function confirmReprovisionCluster() {
    var cluster = state.cluster;
    if (!cluster) {
        return;
    }
    state.pendingReprovision = false;
    renderConfirmation();
    backendCommand("reprovision", ["--cluster-id", cluster.clusterId]).then(function (result) {
        if (!result.ok) {
            showPageAlert((result.errors || ["Cluster reprovision failed."]).join(" "), "danger", "Cluster reprovision failed");
            return;
        }
        window.location.href = "create.html?clusterId=" + encodeURIComponent(cluster.clusterId);
    }).catch(function (error) {
        showPageAlert(String(error), "danger", "Cluster reprovision failed");
    });
}

function renderConfirmation() {
    var card;
    var copy;
    var title;
    var body;
    var actions;
    var confirmButton;
    var cancelButton;
    var isReprovision;

    refs.confirmationRoot.innerHTML = "";
    if ((!state.pendingDestroy && !state.pendingReprovision) || !state.cluster) {
        return;
    }

    isReprovision = state.pendingReprovision;
    card = document.createElement("div");
    copy = document.createElement("div");
    title = document.createElement("div");
    body = document.createElement("div");
    actions = document.createElement("div");
    confirmButton = document.createElement("button");
    cancelButton = document.createElement("button");

    card.className = "confirmation-card confirmation-card--danger";
    title.className = "confirmation-card__title";
    body.className = "confirmation-card__body";
    actions.className = "confirmation-card__actions";

    confirmButton.type = "button";
    confirmButton.className = "action-button action-button--danger";
    cancelButton.type = "button";
    cancelButton.className = "action-button action-button--secondary";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", cancelClusterAction);

    if (isReprovision) {
        title.textContent = "Reprovision cluster " + state.cluster.clusterId + "?";
        body.textContent = "This will destroy the existing cluster and recreate it from its saved configuration. Local VMs, disks, and generated install state will be replaced.";
        confirmButton.textContent = "Reprovision";
        confirmButton.addEventListener("click", confirmReprovisionCluster);
    } else {
        title.textContent = "Destroy cluster " + state.cluster.clusterId + "?";
        body.textContent = "This will delete local VMs, disks, and generated install state for the cluster.";
        confirmButton.textContent = "Destroy";
        confirmButton.addEventListener("click", confirmDestroyCluster);
    }

    copy.appendChild(title);
    copy.appendChild(body);
    actions.appendChild(confirmButton);
    actions.appendChild(cancelButton);
    card.appendChild(copy);
    card.appendChild(actions);
    refs.confirmationRoot.appendChild(card);
}

function renderActions(cluster) {
    refs.actionsMenu.innerHTML = "";

    function addAction(label, handler, disabled) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "action-menu__item";
        button.textContent = label;
        button.disabled = !!disabled;
        button.addEventListener("click", function () {
            closeActionsMenu();
            handler();
        });
        refs.actionsMenu.appendChild(button);
    }

    addAction("Open install workflow", function () {
        window.location.href = "create.html?clusterId=" + encodeURIComponent(cluster.clusterId);
    }, false);

    addAction("Reprovision", function () {
        requestReprovisionCluster();
    }, cluster.synthetic || (state.status && state.status.running));

    addAction("Copy kubeconfig path", function () {
        if (cluster.kubeconfigPath) {
            navigator.clipboard.writeText(cluster.kubeconfigPath).catch(function () {});
        }
    }, !cluster.kubeconfigPath);

    addAction("Refresh inventory", refreshPage, false);

    addAction("Destroy cluster", function () {
        requestDestroyCluster();
    }, cluster.synthetic);
}

function renderOverview() {
    var cluster = state.cluster;
    var statusText;
    var nodeCountText;
    var advisor = [];
    var notices = [];
    var history = [];

    if (!cluster) {
        refs.missing.hidden = false;
        refs.mainPanels.forEach(function (panel) {
            panel.hidden = true;
        });
        refs.openConsole.classList.add("action-button--disabled");
        refs.openConsole.removeAttribute("href");
        return;
    }

    refs.missing.hidden = true;
    refs.mainPanels.forEach(function (panel) {
        if (panel.id === refs.panels[state.activeTab].id) {
            panel.hidden = false;
        }
    });

    statusText = clusterStatus(cluster, state.status);
    nodeCountText = cluster.health && cluster.health.totalNodes
        ? (cluster.health.readyNodes + " ready / " + cluster.health.totalNodes + " total")
        : String(cluster.nodeCount || 0);

    refs.title.textContent = cluster.clusterId;
    refs.subtitle.textContent = statusText + " on " + (cluster.provider || "Local libvirt / KVM");
    refs.breadcrumbName.textContent = cluster.clusterId;
    refs.openConsole.href = cluster.consoleUrl || "#";
    refs.openConsole.classList.toggle("action-button--disabled", !cluster.consoleUrl);
    refs.openConsole.setAttribute("aria-disabled", cluster.consoleUrl ? "false" : "true");

    renderKeyValueList(refs.detailsList, [
        ["Cluster ID", cluster.clusterId],
        ["Status", statusText],
        ["Type", cluster.topology === "sno" ? "Single node" : cluster.topology === "compact" ? "Compact" : "Other"],
        ["Region", cluster.region || "Local KVM host"],
        ["Provider", cluster.provider || "Local libvirt / KVM"],
        ["Channel group", cluster.channelGroup || "Not recorded"],
        ["Version", cluster.openshiftVersion || "Not recorded"],
        ["Created at", formatDate(cluster.createdAt)],
        ["Owner", cluster.owner || "local-admin"],
        ["Node counts", nodeCountText],
        ["vCPU", formatVcpus(cluster.nodeVcpus, cluster.nodeCount)],
        ["Memory", formatMemory(cluster.memoryMb, cluster.nodeCount)]
    ]);

    if (statusText === "Available") {
        advisor.push("Cluster is reporting Available with the API reachable and the control plane ready.");
    } else if (statusText === "Deploying" || statusText === "Provisioning") {
        advisor.push("Continue reviewing the installer workflow for discovery progress, generated manifests, and current execution state.");
    } else {
        advisor.push("Validate kubeconfig access and host health before making lifecycle changes.");
    }
    advisor.push("Use the Create Cluster workflow for YAML-backed network review and post-install artifact inspection.");
    if (cluster.partnerIntegration && cluster.partnerIntegration !== "No platform integration") {
        advisor.push("Partner integration is recorded as " + cluster.partnerIntegration + ".");
    }

    if (cluster.currentTask) {
        notices.push("Current activity: " + cluster.currentTask);
    }
    if (cluster.health && cluster.health.message) {
        notices.push(cluster.health.message);
    }
    if (!cluster.kubeconfigPath) {
        notices.push("Kubeconfig has not been detected yet for this cluster.");
    } else {
        notices.push("Kubeconfig is available at " + cluster.kubeconfigPath + ".");
    }
    if (!notices.length) {
        notices.push("No active notices are currently recorded for this cluster.");
    }

    history.push("Cluster record created: " + formatDate(cluster.createdAt));
    history.push("Current status: " + statusText);
    if (cluster.currentTask) {
        history.push("Latest activity: " + cluster.currentTask);
    }

    renderList(refs.advisorList, advisor);
    renderList(refs.noticesList, notices);
    renderList(refs.historyList, history);

    renderKeyValueList(refs.costSummary, [
        ["Infrastructure", cluster.provider || "Local libvirt / KVM"],
        ["Footprint", formatVcpus(cluster.nodeVcpus, cluster.nodeCount)],
        ["Memory reserved", formatMemory(cluster.memoryMb, cluster.nodeCount)]
    ]);
    renderKeyValueList(refs.lifecycleSummary, [
        ["Lifecycle state", statusText],
        ["Support channel", cluster.channelGroup || "Not recorded"],
        ["Console", cluster.consoleUrl || "Not available"]
    ]);
    renderKeyValueList(refs.subscriptionSummary, [
        ["Partner integration", cluster.partnerIntegration || "No platform integration"],
        ["Operators selected", cluster.operators && cluster.operators.length ? cluster.operators.join(", ") : "Base platform only"],
        ["Kubeconfig path", cluster.kubeconfigPath || "Not available"]
    ]);

    renderActions(cluster);
    renderPageAlert();
    renderConfirmation();
}

function refreshPage() {
    Promise.all([backendCommand("clusters"), backendCommand("status", [], { silentLoading: true })]).then(function (results) {
        state.status = results[1];
        state.cluster = resolveCluster(results[0], results[1]);
        renderOverview();
        renderTabs();
        renderLoadingState();
    }).catch(function (error) {
        refs.missing.hidden = false;
        refs.missing.textContent = String(error);
        refs.mainPanels.forEach(function (panel) {
            panel.hidden = true;
        });
    });
}

function cacheRefs() {
    refs.title = document.getElementById("cluster-page-title");
    refs.subtitle = document.getElementById("cluster-page-subtitle");
    refs.breadcrumbName = document.getElementById("cluster-breadcrumb-name");
    refs.openConsole = document.getElementById("open-console-link");
    refs.refresh = document.getElementById("overview-refresh-button");
    refs.actionsButton = document.getElementById("overview-actions-button");
    refs.actionsMenu = document.getElementById("overview-actions-menu");
    refs.pageAlertRoot = document.getElementById("overview-page-alert");
    refs.confirmationRoot = document.getElementById("overview-confirmation-root");
    refs.tabs = Array.prototype.slice.call(document.querySelectorAll(".overview-tabs__tab"));
    refs.missing = document.getElementById("cluster-missing");
    refs.detailsList = document.getElementById("cluster-details-list");
    refs.advisorList = document.getElementById("advisor-list");
    refs.noticesList = document.getElementById("notices-list");
    refs.costSummary = document.getElementById("cost-summary-list");
    refs.lifecycleSummary = document.getElementById("lifecycle-summary-list");
    refs.subscriptionSummary = document.getElementById("subscription-summary-list");
    refs.historyList = document.getElementById("history-list");
    refs.panels = {
        overview: document.getElementById("overview-tab-panel")
    };
    refs.mainPanels = Object.keys(refs.panels).map(function (key) { return refs.panels[key]; });
}

function bindEvents() {
    refs.refresh.addEventListener("click", refreshPage);
    refs.actionsButton.addEventListener("click", function () {
        if (refs.actionsMenu.hidden) {
            openActionsMenu();
        } else {
            closeActionsMenu();
        }
    });
    document.addEventListener("click", function (event) {
        if (!refs.actionsMenu.contains(event.target) && event.target !== refs.actionsButton) {
            closeActionsMenu();
        }
    });
    refs.tabs.forEach(function (button) {
        button.addEventListener("click", function () {
            state.activeTab = button.dataset.tab;
            renderTabs();
        });
    });
    refs.openConsole.addEventListener("click", function (event) {
        if (!state.cluster || !state.cluster.consoleUrl) {
            event.preventDefault();
        }
    });
}

document.addEventListener("DOMContentLoaded", function () {
    cacheRefs();
    bindEvents();
    refreshPage();
});
