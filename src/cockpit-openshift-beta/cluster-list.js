"use strict";

/* global cockpit */

var HELPER_PATH = "/usr/share/cockpit/cockpit-openshift-beta/installer_backend.py";
var refs = {};
var state = {
    items: [],
    search: "",
    type: "all",
    selectedClusterId: "",
    openMenuClusterId: "",
    page: 1,
    pageSize: 10,
    lastStatus: null
};

function backendCommand(command, extraArgs) {
    var args = ["python3", HELPER_PATH, command];
    if (extraArgs && extraArgs.length) {
        args = args.concat(extraArgs);
    }
    return cockpit.spawn(args, { superuser: "require", err: "message" }).then(function (output) {
        return JSON.parse(output);
    });
}

function formatCreatedDate(value) {
    if (!value) {
        return "Not recorded";
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function clusterIdFromRequest(request) {
    if (!request || !request.clusterName || !request.baseDomain) {
        return "";
    }
    return request.clusterName + "." + request.baseDomain;
}

function clusterStatusInfo(cluster, status) {
    var message = cluster.health && cluster.health.message ? cluster.health.message : "";

    if (status && status.running && cluster.clusterId === clusterIdFromRequest(status.request)) {
        return { label: "Deploying", tone: "status-chip--progress" };
    }
    if (cluster.synthetic) {
        if (status && status.state && status.state.status === "failed") {
            return { label: "Failed", tone: "status-chip--danger" };
        }
        return { label: "Provisioning", tone: "status-chip--progress" };
    }
    if (/expired/i.test(message)) {
        return { label: "Expired", tone: "status-chip--warning" };
    }
    if (!cluster.health) {
        return { label: "Unknown", tone: "status-chip--muted" };
    }
    if (cluster.health.available) {
        return { label: "Ready", tone: "status-chip--success" };
    }
    if (cluster.health.apiReachable) {
        return { label: "API reachable", tone: "status-chip--warning" };
    }
    if (cluster.nodeCount > 0) {
        return { label: "Provisioning", tone: "status-chip--progress" };
    }
    return { label: "Detected", tone: "status-chip--warning" };
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
        provider: request.provider || "Local libvirt / KVM",
        region: request.region || "Local KVM host",
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

function inventoryItems(clustersResult, status) {
    var clusters = (clustersResult.clusters || []).map(function (cluster) {
        cluster.synthetic = false;
        cluster.currentTask = status && status.running && cluster.clusterId === clusterIdFromRequest(status.request) ? (status.currentTask || "") : "";
        return cluster;
    });
    var synthetic = buildSyntheticCluster(status || {});
    if (synthetic && !clusters.some(function (cluster) { return cluster.clusterId === synthetic.clusterId; })) {
        clusters.unshift(synthetic);
    }
    return clusters;
}

function filteredItems() {
    var search = state.search.trim().toLowerCase();
    return state.items.filter(function (item) {
        var matchesType = state.type === "all" || item.topology === state.type;
        var haystack = [
            item.clusterName,
            item.clusterId,
            clusterStatusInfo(item, state.lastStatus).label,
            item.openshiftVersion,
            item.provider
        ].join(" ").toLowerCase();
        var matchesSearch = !search || haystack.indexOf(search) >= 0;
        return matchesType && matchesSearch;
    });
}

function pagedItems(items) {
    var start = (state.page - 1) * state.pageSize;
    return items.slice(start, start + state.pageSize);
}

function navigateToCluster(clusterId) {
    state.selectedClusterId = clusterId;
    render();
    window.location.href = "overview.html?clusterId=" + encodeURIComponent(clusterId);
}

function closeRowMenu() {
    state.openMenuClusterId = "";
    render();
}

function activeMenuAnchor() {
    var buttons;
    var anchor = null;

    if (!state.openMenuClusterId) {
        return null;
    }

    buttons = document.querySelectorAll(".kebab-button[data-cluster-id]");
    buttons.forEach(function (entry) {
        if (entry.getAttribute("data-cluster-id") === state.openMenuClusterId) {
            anchor = entry;
        }
    });

    return anchor;
}

function renderRowMenuOverlay() {
    var item;
    var anchor;
    var rect;
    var menu;
    var menuWidth = 220;
    var left;
    var top;

    refs.rowActionMenuRoot.innerHTML = "";
    if (!state.openMenuClusterId) {
        return;
    }

    item = state.items.find(function (entry) {
        return entry.clusterId === state.openMenuClusterId;
    });
    anchor = activeMenuAnchor();
    if (!item || !anchor) {
        return;
    }

    rect = anchor.getBoundingClientRect();
    left = Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12));
    top = rect.bottom + 8;

    menu = document.createElement("div");
    menu.className = "action-menu action-menu--row action-menu--floating";
    menu.style.left = left + "px";
    menu.style.top = top + "px";

    function addMenuItem(label, handler, disabled) {
        var menuButton = document.createElement("button");
        menuButton.type = "button";
        menuButton.className = "action-menu__item";
        menuButton.textContent = label;
        menuButton.disabled = !!disabled;
        menuButton.addEventListener("click", function (event) {
            event.stopPropagation();
            handler();
        });
        menu.appendChild(menuButton);
    }

    addMenuItem("Open details", function () {
        closeRowMenu();
        navigateToCluster(item.clusterId);
    }, false);
    addMenuItem("Open console", function () {
        closeRowMenu();
        if (item.consoleUrl) {
            window.open(item.consoleUrl, "_blank", "noopener");
        }
    }, !item.consoleUrl);
    addMenuItem("Destroy cluster", function () {
        closeRowMenu();
        if (!window.confirm("Destroy cluster " + item.clusterId + "?")) {
            return;
        }
        backendCommand("destroy", ["--cluster-id", item.clusterId]).then(function (result) {
            if (!result.ok) {
                window.alert((result.errors || ["Cluster destroy failed"]).join("\n"));
                return;
            }
            refreshInventory();
        }).catch(function (error) {
            window.alert(String(error));
        });
    }, item.synthetic);

    refs.rowActionMenuRoot.appendChild(menu);
}

function positionOpenRowMenu() {
    var menu;
    var anchor;
    var button;
    var rect;
    var menuWidth;
    var menuHeight;
    var left;
    var top;

    if (!state.openMenuClusterId) {
        return;
    }

    anchor = activeMenuAnchor();
    menu = refs.rowActionMenuRoot.querySelector(".action-menu--floating");
    if (!anchor || !menu) {
        return;
    }

    button = anchor;
    rect = button.getBoundingClientRect();
    menuWidth = menu.offsetWidth || 220;
    menuHeight = menu.offsetHeight || 0;
    left = Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12));
    top = rect.bottom + 8;
    if (top + menuHeight > window.innerHeight - 12) {
        top = Math.max(12, rect.top - menuHeight - 8);
    }

    menu.style.left = left + "px";
    menu.style.top = top + "px";
}

function pageRangeText(total) {
    if (!total) {
        return "0 - 0 of 0";
    }
    var start = ((state.page - 1) * state.pageSize) + 1;
    var end = Math.min(total, state.page * state.pageSize);
    return start + " - " + end + " of " + total;
}

function inventoryTypeLabel(item) {
    if (item.topology === "sno") {
        return "Single node";
    }
    if (item.topology === "compact") {
        return "Compact";
    }
    return "Other";
}

function renderStatusChip(item) {
    var info = clusterStatusInfo(item, state.lastStatus);
    return '<span class="status-chip ' + info.tone + '">' + info.label + "</span>";
}

function renderRowActionCell(item) {
    var cell = document.createElement("td");
    var wrapper = document.createElement("div");
    var button = document.createElement("button");

    cell.className = "inventory-table__actions-cell";
    wrapper.className = "page-action-menu page-action-menu--row";
    button.type = "button";
    button.className = "kebab-button";
    button.setAttribute("data-cluster-id", item.clusterId);
    button.setAttribute("aria-label", "Cluster row actions");
    button.setAttribute("aria-expanded", state.openMenuClusterId === item.clusterId ? "true" : "false");
    button.innerHTML = '<span aria-hidden="true">&#x22ee;</span>';

    button.addEventListener("click", function (event) {
        event.stopPropagation();
        state.openMenuClusterId = state.openMenuClusterId === item.clusterId ? "" : item.clusterId;
        render();
    });

    wrapper.appendChild(button);
    cell.appendChild(wrapper);
    return cell;
}

function renderRow(item) {
    var row = document.createElement("tr");
    var nameCell = document.createElement("td");
    var statusCell = document.createElement("td");
    var typeCell = document.createElement("td");
    var createdCell = document.createElement("td");
    var versionCell = document.createElement("td");
    var providerCell = document.createElement("td");

    row.className = "inventory-table__row";
    if (state.selectedClusterId === item.clusterId) {
        row.classList.add("inventory-table__row--selected");
    }
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", "Open cluster overview for " + item.clusterId);

    nameCell.innerHTML = '<div class="inventory-table__primary">' + (item.clusterName || item.clusterId) + '</div><div class="inventory-table__secondary">' + item.clusterId + "</div>";
    statusCell.innerHTML = renderStatusChip(item);
    typeCell.textContent = inventoryTypeLabel(item);
    createdCell.textContent = formatCreatedDate(item.createdAt);
    versionCell.textContent = item.openshiftVersion || "Not recorded";
    providerCell.textContent = item.provider || "Local libvirt / KVM";

    [nameCell, statusCell, typeCell, createdCell, versionCell, providerCell].forEach(function (cell) {
        row.appendChild(cell);
    });
    row.appendChild(renderRowActionCell(item));

    row.addEventListener("click", function () {
        navigateToCluster(item.clusterId);
    });
    row.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigateToCluster(item.clusterId);
        }
    });

    return row;
}

function syncPagination(items) {
    var pageCount = Math.max(1, Math.ceil(items.length / state.pageSize));
    if (state.page > pageCount) {
        state.page = pageCount;
    }
    refs.paginationSummary.textContent = pageRangeText(items.length);
    refs.prevButton.disabled = state.page <= 1;
    refs.nextButton.disabled = state.page >= pageCount;
}

function render() {
    var items = filteredItems();
    var visibleItems;

    syncPagination(items);
    visibleItems = pagedItems(items);

    refs.tableBody.innerHTML = "";
    refs.empty.hidden = items.length > 0;
    refs.tableShell.hidden = items.length === 0;
    refs.pagination.hidden = items.length === 0;
    refs.empty.textContent = "No clusters match the current filters.";
    refs.resultCount.textContent = items.length + (items.length === 1 ? " cluster" : " clusters");

    visibleItems.forEach(function (item) {
        refs.tableBody.appendChild(renderRow(item));
    });

    renderRowMenuOverlay();
    positionOpenRowMenu();
}

function refreshInventory() {
    Promise.all([backendCommand("clusters"), backendCommand("status")]).then(function (results) {
        state.lastStatus = results[1];
        state.items = inventoryItems(results[0], results[1]);
        render();
    }).catch(function (error) {
        refs.empty.hidden = false;
        refs.empty.textContent = String(error);
        refs.tableShell.hidden = true;
        refs.pagination.hidden = true;
        refs.resultCount.textContent = "Inventory unavailable";
    });
}

function resetListPosition() {
    state.page = 1;
    state.openMenuClusterId = "";
}

function cacheRefs() {
    refs.clusterListTab = document.getElementById("cluster-list-tab");
    refs.search = document.getElementById("clusters-search");
    refs.type = document.getElementById("cluster-type-filter");
    refs.refresh = document.getElementById("clusters-refresh-button");
    refs.tableBody = document.getElementById("cluster-table-body");
    refs.tableShell = document.querySelector(".fleet-table-shell");
    refs.empty = document.getElementById("clusters-empty");
    refs.resultCount = document.getElementById("clusters-result-count");
    refs.pagination = document.querySelector(".fleet-pagination");
    refs.paginationSummary = document.getElementById("pagination-summary");
    refs.pageSize = document.getElementById("page-size-select");
    refs.prevButton = document.getElementById("page-prev-button");
    refs.nextButton = document.getElementById("page-next-button");
    refs.rowActionMenuRoot = document.getElementById("row-action-menu-root");
}

function bindEvents() {
    refs.search.addEventListener("input", function (event) {
        state.search = event.target.value;
        resetListPosition();
        render();
    });
    refs.type.addEventListener("change", function (event) {
        state.type = event.target.value;
        resetListPosition();
        render();
    });
    refs.refresh.addEventListener("click", refreshInventory);
    refs.pageSize.addEventListener("change", function (event) {
        state.pageSize = parseInt(event.target.value, 10) || 10;
        resetListPosition();
        render();
    });
    refs.prevButton.addEventListener("click", function () {
        if (state.page > 1) {
            state.page -= 1;
            render();
        }
    });
    refs.nextButton.addEventListener("click", function () {
        state.page += 1;
        render();
    });
    document.addEventListener("click", function (event) {
        if (state.openMenuClusterId &&
            !event.target.closest(".page-action-menu--row") &&
            !event.target.closest(".action-menu--floating")) {
            state.openMenuClusterId = "";
            render();
        }
    });
    refs.tableShell.addEventListener("scroll", function () {
        if (state.openMenuClusterId) {
            closeRowMenu();
        }
    });
    window.addEventListener("resize", function () {
        if (state.openMenuClusterId) {
            closeRowMenu();
        }
    });
}

document.addEventListener("DOMContentLoaded", function () {
    cacheRefs();
    bindEvents();
    refreshInventory();
});
