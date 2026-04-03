"use strict";

/* global cockpit */

var HELPER_PATH = "/usr/share/cockpit/cockpit-assisted-installer-local/installer_backend.py";

var steps = [
    { id: 1, label: "Cluster details", description: "Define the cluster identity and the local secret inputs." },
    { id: 2, label: "Operators", description: "Operator selection is reserved for a later pass. This backend currently uses the installer defaults." },
    { id: 3, label: "Host discovery", description: "The local backend generates its own agent ISO and lets the cluster discovery happen through the native agent flow." },
    { id: 4, label: "Storage", description: "Choose the VM sizing, storage pool, and optional local performance domain." },
    { id: 5, label: "Networking", description: "Provide the static machine network, node IPs, and VIPs required by the local backend." },
    { id: 6, label: "Custom manifests", description: "Custom manifests are not wired yet. This backend currently uses only generated installer inputs." },
    { id: 7, label: "Review and create", description: "Review the generated request, validate local prerequisites, and start the deployment." }
];

var initialState = {
    currentStep: 1,
    yamlMode: false,
    yamlPaneWidth: 560,
    clusterName: "",
    baseDomain: "localhost.com",
    openshiftVersion: "OpenShift 4.21.7",
    cpuArchitecture: "x86_64",
    controlPlaneCount: 3,
    hostsNetworkConfiguration: "dhcp",
    disconnectedEnvironment: false,
    encryptionControlPlane: false,
    encryptionWorkers: false,
    encryptionArbiter: false,
    pullSecretValue: "",
    pullSecretFile: "",
    sshPublicKeyValue: "",
    sshPublicKeyFile: "",
    bridgeName: "",
    nodeVcpus: 10,
    nodeMemoryMb: 16384,
    diskSizeGb: 120,
    storagePool: "",
    performanceDomain: "none",
    machineCidr: "",
    machineGateway: "",
    dnsServers: "",
    controlPlaneIp1: "",
    controlPlaneIp2: "",
    controlPlaneIp3: "",
    apiVip: "",
    ingressVip: "",
    availableBridges: [],
    availableStoragePools: [],
    artifacts: [],
    currentArtifactName: "",
    clusters: [],
    backendErrors: [],
    job: null
};

var state = cloneState(initialState);
var refs = {};
var pollTimer = null;
var artifactPreviewTimer = null;
var lastArtifactPreviewKey = "";

function cloneState(source) {
    return JSON.parse(JSON.stringify(source));
}

function encodePayload(payload) {
    return window.btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function backendCommand(command, extraArgs) {
    var args = ["python3", HELPER_PATH, command];
    if (extraArgs && extraArgs.length) {
        args = args.concat(extraArgs);
    }
    return cockpit.spawn(args, { superuser: "require", err: "message" })
        .then(function (output) { return JSON.parse(output); });
}

function dnsServerList() {
    return state.dnsServers.split(",").map(function (entry) {
        return entry.trim();
    }).filter(function (entry) {
        return entry.length > 0;
    });
}

function nodeIpList() {
    var ips = [state.controlPlaneIp1.trim()];
    if (state.controlPlaneCount === 3) {
        ips.push(state.controlPlaneIp2.trim());
        ips.push(state.controlPlaneIp3.trim());
    }
    return ips.filter(function (entry) { return entry.length > 0; });
}

function payload() {
    return {
        clusterName: state.clusterName.trim(),
        baseDomain: state.baseDomain.trim(),
        openshiftVersion: state.openshiftVersion,
        cpuArchitecture: state.cpuArchitecture,
        controlPlaneCount: state.controlPlaneCount,
        hostsNetworkConfiguration: state.hostsNetworkConfiguration,
        disconnectedEnvironment: state.disconnectedEnvironment,
        encryptionControlPlane: state.encryptionControlPlane,
        encryptionWorkers: state.encryptionWorkers,
        encryptionArbiter: state.encryptionArbiter,
        pullSecretValue: state.pullSecretValue,
        pullSecretFile: state.pullSecretFile.trim(),
        sshPublicKeyValue: state.sshPublicKeyValue,
        sshPublicKeyFile: state.sshPublicKeyFile.trim(),
        bridgeName: state.bridgeName,
        performanceDomain: state.performanceDomain,
        compute: {
            nodeVcpus: parseInt(state.nodeVcpus, 10),
            nodeMemoryMb: parseInt(state.nodeMemoryMb, 10)
        },
        storage: {
            storagePool: state.storagePool,
            diskSizeGb: parseInt(state.diskSizeGb, 10)
        },
        network: {
            machineCidr: state.machineCidr.trim(),
            machineGateway: state.machineGateway.trim(),
            dnsServers: dnsServerList(),
            nodeIps: nodeIpList(),
            apiVip: state.apiVip.trim(),
            ingressVip: state.ingressVip.trim()
        }
    };
}

function currentArtifact() {
    var selected = null;
    state.artifacts.forEach(function (artifact) {
        if (artifact.name === state.currentArtifactName) {
            selected = artifact;
        }
    });
    return selected || (state.artifacts.length ? state.artifacts[0] : null);
}

function clampYamlPaneWidth(width) {
    var workspaceWidth = refs.wizardWorkspace ? refs.wizardWorkspace.clientWidth : 1280;
    var minWidth = 420;
    var maxWidth = Math.max(520, Math.floor(workspaceWidth * 0.5));
    return Math.max(minWidth, Math.min(width, maxWidth));
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function highlightYamlLine(line) {
    var escaped = escapeHtml(line);

    if (/^\s*#/.test(line)) {
        return '<span class="yaml-comment">' + escaped + "</span>";
    }

    escaped = escaped.replace(/^(\s*)([A-Za-z0-9_.-]+)(:)/, function (match, indent, key, colon) {
        return indent + '<span class="yaml-key">' + key + "</span>" + '<span class="yaml-punctuation">' + colon + "</span>";
    });
    escaped = escaped.replace(/(:\s*)(true|false|null)(\s*)$/i, function (match, prefix, value, suffix) {
        return '<span class="yaml-punctuation">:</span>' + prefix.slice(1) + '<span class="yaml-boolean">' + value + "</span>" + suffix;
    });
    escaped = escaped.replace(/(:\s*)(-?\d+(?:\.\d+)?)(\s*)$/i, function (match, prefix, value, suffix) {
        return '<span class="yaml-punctuation">:</span>' + prefix.slice(1) + '<span class="yaml-number">' + value + "</span>" + suffix;
    });
    escaped = escaped.replace(/(:\s*)(".*")(\s*)$/, function (match, prefix, value, suffix) {
        return '<span class="yaml-punctuation">:</span>' + prefix.slice(1) + '<span class="yaml-string">' + value + "</span>" + suffix;
    });
    return escaped;
}

function renderArtifactCode(content, name) {
    var lines = content.split("\n");
    refs.artifactLineNumbers.innerHTML = lines.map(function (_, index) {
        return '<div class="yaml-editor__line-number">' + (index + 1) + "</div>";
    }).join("");

    if (/\.ya?ml$/i.test(name)) {
        refs.artifactContent.innerHTML = lines.map(highlightYamlLine).join("\n");
    } else {
        refs.artifactContent.innerHTML = escapeHtml(content);
    }
}

function artifactPreviewKey() {
    if (!state.yamlMode) {
        return "";
    }
    if (state.job && state.job.state && state.job.state.mode === "destroy") {
        return "destroy";
    }
    return JSON.stringify(payload());
}

function scheduleArtifactPreviewRefresh(force) {
    var key;

    if (!state.yamlMode || (state.job && state.job.state && state.job.state.mode === "destroy")) {
        return;
    }

    key = artifactPreviewKey();
    if (!force && key === lastArtifactPreviewKey) {
        return;
    }

    window.clearTimeout(artifactPreviewTimer);
    artifactPreviewTimer = window.setTimeout(function () {
        loadArtifactsInternal("payload", true, key).catch(function () {});
    }, 250);
}

function applyRequestToState(request) {
    if (!request) {
        return;
    }

    state.clusterName = request.clusterName || state.clusterName;
    state.baseDomain = request.baseDomain || state.baseDomain;
    state.openshiftVersion = request.openshiftVersion || state.openshiftVersion;
    state.cpuArchitecture = request.cpuArchitecture || state.cpuArchitecture;
    state.controlPlaneCount = request.topology === "sno" ? 1 : 3;
    state.hostsNetworkConfiguration = request.hostsNetworkConfiguration || state.hostsNetworkConfiguration;
    state.bridgeName = request.network && request.network.bridgeName ? request.network.bridgeName : state.bridgeName;
    state.performanceDomain = request.compute && request.compute.performanceDomain ? request.compute.performanceDomain : state.performanceDomain;
    state.nodeVcpus = request.compute && request.compute.nodeVcpus ? request.compute.nodeVcpus : state.nodeVcpus;
    state.nodeMemoryMb = request.compute && request.compute.nodeMemoryMb ? request.compute.nodeMemoryMb : state.nodeMemoryMb;
    state.storagePool = request.storage && request.storage.storagePool ? request.storage.storagePool : state.storagePool;
    state.diskSizeGb = request.storage && request.storage.diskSizeGb ? request.storage.diskSizeGb : state.diskSizeGb;
    state.machineCidr = request.network && request.network.machineCidr ? request.network.machineCidr : state.machineCidr;
    state.machineGateway = request.network && request.network.machineGateway ? request.network.machineGateway : state.machineGateway;
    state.dnsServers = request.network && request.network.dnsServers ? request.network.dnsServers.join(", ") : state.dnsServers;
    state.controlPlaneIp1 = request.network && request.network.nodeIps && request.network.nodeIps[0] ? request.network.nodeIps[0] : "";
    state.controlPlaneIp2 = request.network && request.network.nodeIps && request.network.nodeIps[1] ? request.network.nodeIps[1] : "";
    state.controlPlaneIp3 = request.network && request.network.nodeIps && request.network.nodeIps[2] ? request.network.nodeIps[2] : "";
    state.apiVip = request.network && request.network.apiVip ? request.network.apiVip : "";
    state.ingressVip = request.network && request.network.ingressVip ? request.network.ingressVip : "";

    if (request.secretInputs) {
        state.pullSecretFile = request.secretInputs.pullSecretSource === "file" ? (request.secretInputs.pullSecretFile || "") : "";
        state.sshPublicKeyFile = request.secretInputs.sshPublicKeySource === "file" ? (request.secretInputs.sshPublicKeyFile || "") : "";
    }
}

function activeJobClusterId() {
    if (!state.job || !state.job.state || !state.job.state.clusterName || !state.job.state.baseDomain) {
        return "";
    }
    return state.job.state.clusterName + "." + state.job.state.baseDomain;
}

function clusterStatusLabel(cluster) {
    if (state.job && state.job.running && cluster.clusterId === activeJobClusterId()) {
        if (state.job.state.mode === "destroy") {
            return "Destroying";
        }
        return "Deploying";
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

function currentStepMeta() {
    return steps[state.currentStep - 1];
}

function currentStepErrors() {
    var errors = [];

    if (state.currentStep === 1) {
        if (!state.clusterName.trim()) errors.push("Cluster name");
        if (!state.baseDomain.trim()) errors.push("Base domain");
        if (state.cpuArchitecture !== "x86_64") errors.push("CPU architecture");
        if (!state.pullSecretValue.trim() && !state.pullSecretFile.trim()) errors.push("Pull secret");
        if (!state.sshPublicKeyValue.trim() && !state.sshPublicKeyFile.trim()) errors.push("SSH public key");
        if (state.disconnectedEnvironment) errors.push("Disconnected environment");
        if (state.encryptionControlPlane || state.encryptionWorkers || state.encryptionArbiter) errors.push("Encryption of installation disks");
    }

    if (state.currentStep === 4) {
        if (!state.bridgeName) errors.push("Bridge interface");
        if (!state.storagePool) errors.push("Storage pool");
        if (!(parseInt(state.nodeVcpus, 10) > 0)) errors.push("Control plane vCPU count");
        if (!(parseInt(state.nodeMemoryMb, 10) > 0)) errors.push("Control plane memory");
        if (!(parseInt(state.diskSizeGb, 10) > 0)) errors.push("Root disk size");
    }

    if (state.currentStep === 5) {
        if (state.hostsNetworkConfiguration !== "static") errors.push("Hosts' network configuration");
        if (!state.machineCidr.trim()) errors.push("Machine network CIDR");
        if (!state.machineGateway.trim()) errors.push("Machine gateway");
        if (dnsServerList().length === 0) errors.push("DNS servers");
        if (!state.controlPlaneIp1.trim()) errors.push("Control plane node 1 IP");
        if (state.controlPlaneCount === 3 && !state.controlPlaneIp2.trim()) errors.push("Control plane node 2 IP");
        if (state.controlPlaneCount === 3 && !state.controlPlaneIp3.trim()) errors.push("Control plane node 3 IP");
        if (state.controlPlaneCount === 3 && !state.apiVip.trim()) errors.push("API VIP");
        if (state.controlPlaneCount === 3 && !state.ingressVip.trim()) errors.push("Ingress VIP");
    }

    return errors;
}

function overallErrors() {
    var savedStep = state.currentStep;
    var all = [];
    var seen = {};
    var step;

    for (step = 1; step <= steps.length; step += 1) {
        state.currentStep = step;
        currentStepErrors().forEach(function (entry) {
            if (!seen[entry]) {
                seen[entry] = true;
                all.push(entry);
            }
        });
    }
    state.currentStep = savedStep;

    state.backendErrors.forEach(function (entry) {
        if (!seen[entry]) {
            seen[entry] = true;
            all.push(entry);
        }
    });

    return all;
}

function setFieldInvalid(inputRef, fieldRef, invalid) {
    if (inputRef) {
        inputRef.classList.toggle("is-invalid", invalid);
        inputRef.setAttribute("aria-invalid", invalid ? "true" : "false");
    }
    if (fieldRef) {
        fieldRef.classList.toggle("is-invalid", invalid);
    }
}

function renderFieldValidation() {
    var errors = currentStepErrors();

    setFieldInvalid(refs.clusterName, refs.clusterNameField, errors.indexOf("Cluster name") >= 0);
    setFieldInvalid(refs.baseDomain, refs.baseDomainField, errors.indexOf("Base domain") >= 0);
    setFieldInvalid(refs.pullSecretValue, refs.pullSecretValueField, errors.indexOf("Pull secret") >= 0);
    setFieldInvalid(refs.pullSecretFile, refs.pullSecretFileField, errors.indexOf("Pull secret") >= 0);
    setFieldInvalid(refs.sshPublicKeyValue, refs.sshPublicKeyValueField, errors.indexOf("SSH public key") >= 0);
    setFieldInvalid(refs.sshPublicKeyFile, refs.sshPublicKeyFileField, errors.indexOf("SSH public key") >= 0);
    setFieldInvalid(refs.cpuArchitecture, refs.cpuArchitectureField, errors.indexOf("CPU architecture") >= 0);
    setFieldInvalid(null, refs.diskEncryptionField, errors.indexOf("Encryption of installation disks") >= 0);

    setFieldInvalid(refs.bridgeName, refs.bridgeNameField, errors.indexOf("Bridge interface") >= 0);
    setFieldInvalid(refs.storagePool, refs.storagePoolField, errors.indexOf("Storage pool") >= 0);
    setFieldInvalid(refs.nodeVcpus, refs.nodeVcpusField, errors.indexOf("Control plane vCPU count") >= 0);
    setFieldInvalid(refs.nodeMemoryMb, refs.nodeMemoryMbField, errors.indexOf("Control plane memory") >= 0);
    setFieldInvalid(refs.diskSizeGb, refs.diskSizeGbField, errors.indexOf("Root disk size") >= 0);

    setFieldInvalid(null, refs.hostsNetworkField, errors.indexOf("Hosts' network configuration") >= 0);
    setFieldInvalid(refs.machineCidr, refs.machineCidrField, errors.indexOf("Machine network CIDR") >= 0);
    setFieldInvalid(refs.machineGateway, refs.machineGatewayField, errors.indexOf("Machine gateway") >= 0);
    setFieldInvalid(refs.dnsServers, refs.dnsServersField, errors.indexOf("DNS servers") >= 0);
    setFieldInvalid(refs.controlPlaneIp1, refs.controlPlaneIp1Field, errors.indexOf("Control plane node 1 IP") >= 0);
    setFieldInvalid(refs.controlPlaneIp2, refs.controlPlaneIp2Field, errors.indexOf("Control plane node 2 IP") >= 0);
    setFieldInvalid(refs.controlPlaneIp3, refs.controlPlaneIp3Field, errors.indexOf("Control plane node 3 IP") >= 0);
    setFieldInvalid(refs.apiVip, refs.apiVipField, errors.indexOf("API VIP") >= 0);
    setFieldInvalid(refs.ingressVip, refs.ingressVipField, errors.indexOf("Ingress VIP") >= 0);

    refs.clusterNameError.hidden = errors.indexOf("Cluster name") < 0;
}

function renderValidationAlert() {
    var errors = currentStepErrors();
    var reviewErrors = overallErrors();

    refs.validationAlert.hidden = !(errors.length > 0 && state.currentStep !== 7);
    refs.validationAlertBody.textContent = refs.validationAlert.hidden
        ? ""
        : "The following fields are invalid or missing: " + errors.join(", ") + ".";

    refs.preflightAlert.hidden = !(state.currentStep === 7 && reviewErrors.length > 0);
    refs.preflightAlertBody.textContent = refs.preflightAlert.hidden
        ? ""
        : "The following fields are invalid or missing: " + reviewErrors.join(", ") + ".";
}

function renderStepList() {
    refs.stepList.innerHTML = "";
    steps.forEach(function (step) {
        var item = document.createElement("li");
        var classes = ["wizard-step"];
        if (step.id === state.currentStep) {
            classes.push("wizard-step--active");
        } else if (step.id < state.currentStep) {
            classes.push("wizard-step--complete", "wizard-step--clickable");
        } else {
            classes.push("wizard-step--disabled");
        }
        item.className = classes.join(" ");
        item.setAttribute("aria-current", step.id === state.currentStep ? "step" : "false");
        if (step.id < state.currentStep) {
            item.addEventListener("click", function () {
                state.currentStep = step.id;
                state.backendErrors = [];
                render();
            });
        }

        var num = document.createElement("span");
        num.className = "wizard-step__number";
        num.textContent = String(step.id);
        var label = document.createElement("span");
        label.className = "wizard-step__label";
        label.textContent = step.label;

        item.appendChild(num);
        item.appendChild(label);
        refs.stepList.appendChild(item);
    });
}

function renderPanels() {
    steps.forEach(function (step) {
        refs["step" + step.id].hidden = step.id !== state.currentStep;
    });
    refs.stepTitle.textContent = currentStepMeta().label;
    refs.stepDescription.textContent = currentStepMeta().description;
}

function renderTopology() {
    var compact = state.controlPlaneCount === 3;
    refs.controlPlaneIp2Field.hidden = !compact;
    refs.controlPlaneIp3Field.hidden = !compact;
    refs.compactVipsSection.hidden = !compact;
    refs.snoVipsNote.hidden = compact;
}

function renderSelectOptions(select, values, selected) {
    select.innerHTML = "";
    values.forEach(function (value) {
        var option = document.createElement("option");
        if (typeof value === "string") {
            option.value = value;
            option.textContent = value;
        } else {
            option.value = value.value;
            option.textContent = value.label;
            if (value.disabled) option.disabled = true;
        }
        if (option.value === selected) option.selected = true;
        select.appendChild(option);
    });
}

function renderOptions() {
    var poolOptions = state.availableStoragePools.map(function (pool) {
        var label = pool.name + " (" + pool.type + ", " + (pool.active ? "active" : "inactive") + ")";
        return { value: pool.name, label: label, disabled: !pool.supported };
    });
    if (poolOptions.length === 0) {
        poolOptions = [{ value: "", label: "No supported storage pools found", disabled: true }];
    }
    renderSelectOptions(refs.storagePool, poolOptions, state.storagePool);

    var bridgeOptions = state.availableBridges.length > 0 ? state.availableBridges : [""];
    renderSelectOptions(refs.bridgeName, bridgeOptions, state.bridgeName);
}

function renderArtifacts() {
    refs.artifactTabs.innerHTML = "";
    if (!state.artifacts.length) {
        refs.artifactEmpty.hidden = false;
        refs.artifactEditor.hidden = true;
        refs.artifactContent.textContent = "";
        refs.artifactContent.innerHTML = "";
        refs.artifactLineNumbers.innerHTML = "";
        refs.artifactCopyButton.disabled = true;
        refs.artifactDownloadButton.disabled = true;
        return;
    }

    refs.artifactEmpty.hidden = true;
    refs.artifactEditor.hidden = false;
    state.artifacts.forEach(function (artifact) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "artifact-tab" + (artifact.name === currentArtifact().name ? " artifact-tab--active" : "");
        button.textContent = artifact.name;
        button.addEventListener("click", function () {
            state.currentArtifactName = artifact.name;
            renderArtifacts();
        });
        refs.artifactTabs.appendChild(button);
    });

    renderArtifactCode(currentArtifact().content, currentArtifact().name);
    refs.artifactCopyButton.disabled = false;
    refs.artifactDownloadButton.disabled = false;
}

function renderClusters() {
    refs.clustersList.innerHTML = "";
    if (!state.clusters.length) {
        refs.clustersList.textContent = "No deployed clusters found.";
        return;
    }

    state.clusters.forEach(function (cluster) {
        var card = document.createElement("div");
        var header = document.createElement("div");
        var titleWrap = document.createElement("div");
        var title = document.createElement("h4");
        var meta = document.createElement("p");
        var actions = document.createElement("div");
        var destroyButton = document.createElement("button");
        var details = document.createElement("dl");

        card.className = "cluster-card";
        header.className = "cluster-card__header";
        title.className = "cluster-card__title";
        meta.className = "cluster-card__meta";
        details.className = "review-list";
        actions.className = "artifact-actions";

        title.textContent = cluster.clusterName + "." + cluster.baseDomain;
        meta.textContent = cluster.topology + " | " + clusterStatusLabel(cluster);

        destroyButton.type = "button";
        destroyButton.className = "action-button action-button--secondary action-button--danger";
        destroyButton.textContent = "Destroy";
        destroyButton.disabled = state.job && state.job.running;
        destroyButton.addEventListener("click", function () {
            destroyCluster(cluster.clusterId);
        });

        [
            ["Console", cluster.consoleUrl],
            ["Nodes", String(cluster.health && cluster.health.totalNodes ? cluster.health.totalNodes : cluster.nodeCount)],
            ["Ready", cluster.health ? (cluster.health.readyNodes + "/" + cluster.health.totalNodes) : "Unknown"],
            ["Kubeconfig", cluster.kubeconfigPath]
        ].forEach(function (row) {
            var dt = document.createElement("dt");
            var dd = document.createElement("dd");
            dt.textContent = row[0];
            dd.textContent = row[1] || "Not available";
            details.appendChild(dt);
            details.appendChild(dd);
        });

        titleWrap.appendChild(title);
        titleWrap.appendChild(meta);
        actions.appendChild(destroyButton);
        header.appendChild(titleWrap);
        header.appendChild(actions);
        card.appendChild(header);
        card.appendChild(details);
        refs.clustersList.appendChild(card);
    });
}

function reviewRows() {
    var topology = state.controlPlaneCount === 1 ? "Single Node OpenShift (SNO)" : "Compact 3-node";
    var vipSummary = state.controlPlaneCount === 1
        ? (state.controlPlaneIp1.trim() || "Not set")
        : ((state.apiVip.trim() || "Not set") + " / " + (state.ingressVip.trim() || "Not set"));
    var pullSecretSource = state.pullSecretValue.trim() ? "Pasted into form" : (state.pullSecretFile.trim() || "Not set");
    var sshPublicKeySource = state.sshPublicKeyValue.trim() ? "Pasted into form" : (state.sshPublicKeyFile.trim() || "Not set");
    return [
        ["Topology", topology],
        ["Cluster", (state.clusterName.trim() || "Not set") + "." + (state.baseDomain.trim() || "Not set")],
        ["OpenShift version", state.openshiftVersion],
        ["Pull secret", pullSecretSource],
        ["SSH public key", sshPublicKeySource],
        ["Bridge", state.bridgeName || "Not set"],
        ["Storage pool", state.storagePool || "Not set"],
        ["Control plane vCPU", String(state.nodeVcpus)],
        ["Control plane memory", String(state.nodeMemoryMb) + " MiB"],
        ["Root disk size", String(state.diskSizeGb) + " GiB"],
        ["Performance domain", state.performanceDomain],
        ["Machine network CIDR", state.machineCidr.trim() || "Not set"],
        ["DNS servers", dnsServerList().join(", ") || "Not set"],
        ["Control plane IPs", nodeIpList().join(", ") || "Not set"],
        ["VIPs", vipSummary]
    ];
}

function renderReview() {
    refs.reviewList.innerHTML = "";
    reviewRows().forEach(function (row) {
        var dt = document.createElement("dt");
        dt.textContent = row[0];
        var dd = document.createElement("dd");
        dd.textContent = row[1];
        refs.reviewList.appendChild(dt);
        refs.reviewList.appendChild(dd);
    });
}

function renderJob() {
    if (!state.job) {
        refs.jobStatusSummary.textContent = "No deployment has been started yet.";
        refs.jobCurrentTask.textContent = "";
        refs.jobLog.textContent = "No log output yet.";
        refs.installAccessCard.hidden = true;
        refs.installAccessList.innerHTML = "";
        return;
    }
    var action = state.job.state && state.job.state.mode === "destroy" ? "Destroy" : "Deployment";
    var summary = action + " status: " + (state.job.state.status || "unknown");
    if (state.job.state.clusterName && state.job.state.baseDomain) {
        summary += " for " + state.job.state.clusterName + "." + state.job.state.baseDomain;
    }
    refs.jobStatusSummary.textContent = summary;
    refs.jobCurrentTask.textContent = state.job.currentTask || "";
    refs.jobLog.textContent = state.job.logTail && state.job.logTail.length
        ? state.job.logTail.join("\n")
        : "No log output yet.";

    refs.installAccessList.innerHTML = "";
    if (state.job.state && state.job.state.installAccess) {
        [
            ["Console endpoint", state.job.state.installAccess.consoleUrl || "Not available"],
            ["Username", state.job.state.installAccess.kubeadminUsername || "Not available"],
            ["Password", state.job.state.installAccess.kubeadminPassword || "Not available"]
        ].forEach(function (row) {
            var dt = document.createElement("dt");
            dt.textContent = row[0];
            var dd = document.createElement("dd");
            dd.textContent = row[1];
            refs.installAccessList.appendChild(dt);
            refs.installAccessList.appendChild(dd);
        });
        refs.installAccessCard.hidden = false;
    } else {
        refs.installAccessCard.hidden = true;
    }
}

function renderFooter() {
    var onReview = state.currentStep === 7;
    var hasRunningJob = state.job && state.job.running;
    var jobStatus = state.job && state.job.state ? state.job.state.status : "";
    var jobSucceeded = jobStatus === "succeeded";
    var jobFinished = jobStatus === "succeeded" || jobStatus === "failed" || jobStatus === "canceled";

    refs.backButton.hidden = state.currentStep === 1;
    refs.nextButton.hidden = onReview;
    refs.deployButton.hidden = !onReview || jobSucceeded;
    refs.redeployButton.hidden = !onReview;
    refs.stopButton.hidden = !hasRunningJob;

    refs.nextButton.disabled = currentStepErrors().length > 0;
    refs.deployButton.disabled = overallErrors().length > 0 || hasRunningJob || jobSucceeded;
    refs.redeployButton.disabled = overallErrors().length > 0 || hasRunningJob;
    refs.cancelButton.textContent = hasRunningJob || jobFinished || onReview ? "Reset view" : "Cancel";
}

function renderYamlPane() {
    refs.wizardWorkspace.classList.toggle("wizard-workspace--yaml", state.yamlMode);
    refs.yamlPane.hidden = !state.yamlMode;
    refs.yamlDivider.hidden = !state.yamlMode;
    refs.yamlToggle.checked = state.yamlMode;
    refs.wizardWorkspace.style.setProperty("--yaml-pane-width", clampYamlPaneWidth(state.yamlPaneWidth) + "px");
}

function render() {
    refs.yamlToggle.checked = state.yamlMode;
    refs.clusterName.value = state.clusterName;
    refs.baseDomain.value = state.baseDomain;
    refs.openshiftVersion.value = state.openshiftVersion;
    refs.cpuArchitecture.value = state.cpuArchitecture;
    refs.controlPlaneCount.value = String(state.controlPlaneCount);
    refs.networkDhcp.checked = state.hostsNetworkConfiguration === "dhcp";
    refs.networkStatic.checked = state.hostsNetworkConfiguration === "static";
    refs.encryptControlPlane.checked = state.encryptionControlPlane;
    refs.encryptWorkers.checked = state.encryptionWorkers;
    refs.encryptArbiter.checked = state.encryptionArbiter;
    refs.pullSecretValue.value = state.pullSecretValue;
    refs.pullSecretFile.value = state.pullSecretFile;
    refs.sshPublicKeyValue.value = state.sshPublicKeyValue;
    refs.sshPublicKeyFile.value = state.sshPublicKeyFile;
    refs.nodeVcpus.value = String(state.nodeVcpus);
    refs.nodeMemoryMb.value = String(state.nodeMemoryMb);
    refs.diskSizeGb.value = String(state.diskSizeGb);
    refs.performanceDomain.value = state.performanceDomain;
    refs.machineCidr.value = state.machineCidr;
    refs.machineGateway.value = state.machineGateway;
    refs.dnsServers.value = state.dnsServers;
    refs.controlPlaneIp1.value = state.controlPlaneIp1;
    refs.controlPlaneIp2.value = state.controlPlaneIp2;
    refs.controlPlaneIp3.value = state.controlPlaneIp3;
    refs.apiVip.value = state.apiVip;
    refs.ingressVip.value = state.ingressVip;

    renderStepList();
    renderYamlPane();
    renderPanels();
    renderTopology();
    renderOptions();
    renderReview();
    renderClusters();
    renderArtifacts();
    renderFieldValidation();
    renderValidationAlert();
    renderFooter();
    renderJob();
}

function clearBackendErrors() {
    state.backendErrors = [];
}

function setJobFromStatus(status) {
    state.job = {
        running: status.running,
        state: status.state || {},
        service: status.service || {},
        logTail: status.logTail || [],
        currentTask: status.currentTask || ""
    };
    if (status.request) {
        applyRequestToState(status.request);
    }
}

function shouldResetAfterDestroy(status, clusters) {
    return !!(
        status &&
        !status.running &&
        status.state &&
        status.state.mode === "destroy" &&
        status.state.status === "succeeded" &&
        (!clusters || clusters.length === 0)
    );
}

function stopPolling() {
    if (pollTimer) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
    }
}

function schedulePoll() {
    stopPolling();
    if (state.job && state.job.running) {
        pollTimer = window.setTimeout(refreshStatus, 5000);
    }
}

function refreshStatus() {
    backendCommand("status").then(function (status) {
        setJobFromStatus(status);
        if (status.running) {
            state.currentStep = 7;
        }
        if (state.currentStep === 7 &&
            !state.artifacts.length &&
            status.state &&
            status.state.clusterName &&
            status.state.mode !== "destroy") {
            loadArtifacts("current");
        }
        loadClusters().then(function (result) {
            if (shouldResetAfterDestroy(status, result.clusters || [])) {
                state.job = null;
                state.artifacts = [];
                state.currentArtifactName = "";
                state.backendErrors = [];
                lastArtifactPreviewKey = "";
            }
            render();
            schedulePoll();
        }).catch(function () {
            render();
            schedulePoll();
        });
    }).catch(function (error) {
        state.backendErrors = [String(error)];
        render();
    });
}

function startYamlResize(event) {
    var startX;
    var startWidth;

    if (!state.yamlMode || window.innerWidth <= 960) {
        return;
    }

    startX = event.clientX;
    startWidth = clampYamlPaneWidth(state.yamlPaneWidth);

    function onMove(moveEvent) {
        state.yamlPaneWidth = clampYamlPaneWidth(startWidth - (moveEvent.clientX - startX));
        renderYamlPane();
    }

    function onUp() {
        document.body.classList.remove("is-resizing-yaml");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
    }

    event.preventDefault();
    document.body.classList.add("is-resizing-yaml");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
}

function loadOptions() {
    return backendCommand("options").then(function (result) {
        state.availableStoragePools = result.storagePools || [];
        state.availableBridges = result.bridges || [];
        if (!state.storagePool && result.defaults && result.defaults.storagePool) {
            state.storagePool = result.defaults.storagePool;
        }
        if (!state.bridgeName && result.defaults && result.defaults.bridgeName) {
            state.bridgeName = result.defaults.bridgeName;
        }
        if (!state.pullSecretFile && result.defaults && result.defaults.pullSecretFile) {
            state.pullSecretFile = result.defaults.pullSecretFile;
        }
        if (!state.sshPublicKeyFile && result.defaults && result.defaults.sshPublicKeyFile) {
            state.sshPublicKeyFile = result.defaults.sshPublicKeyFile;
        }
        if (!state.performanceDomain && result.defaults && result.defaults.performanceDomain) {
            state.performanceDomain = result.defaults.performanceDomain;
        }
        render();
    }).catch(function (error) {
        state.backendErrors = [String(error)];
        render();
    });
}

function loadArtifacts(mode) {
    return loadArtifactsInternal(mode, false, "");
}

function loadArtifactsInternal(mode, silent, key) {
    var args = mode === "current"
        ? ["--current"]
        : ["--payload-b64", encodePayload(payload())];
    return backendCommand("artifacts", args).then(function (result) {
        state.artifacts = result.artifacts || [];
        if (!state.currentArtifactName || !state.artifacts.some(function (artifact) { return artifact.name === state.currentArtifactName; })) {
            state.currentArtifactName = state.artifacts.length ? state.artifacts[0].name : "";
        }
        if (key) {
            lastArtifactPreviewKey = key;
        }
        render();
        return result;
    }).catch(function (error) {
        state.artifacts = [];
        state.currentArtifactName = "";
        if (!silent) {
            state.backendErrors = [String(error)];
        }
        render();
        throw error;
    });
}

function loadClusters() {
    return backendCommand("clusters").then(function (result) {
        state.clusters = result.clusters || [];
        render();
        return result;
    }).catch(function (error) {
        state.backendErrors = [String(error)];
        render();
        throw error;
    });
}

function runPreflight() {
    return backendCommand("preflight", ["--payload-b64", encodePayload(payload())]).then(function (result) {
        state.backendErrors = result.ok ? [] : (result.errors || []);
        render();
        return result;
    }).catch(function (error) {
        state.backendErrors = [String(error)];
        render();
        throw error;
    });
}

function goNext() {
    if (currentStepErrors().length > 0) {
        render();
        return;
    }
    if (state.currentStep < steps.length) {
        state.currentStep += 1;
        render();
        if (state.currentStep === 7) {
            runPreflight();
            loadArtifacts("payload");
            refreshStatus();
        }
    }
}

function goBack() {
    if (state.currentStep > 1) {
        state.currentStep -= 1;
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    }
}

function startDeployment(mode) {
    clearBackendErrors();
    render();
    backendCommand("start", ["--payload-b64", encodePayload(payload()), "--mode", mode]).then(function (result) {
        if (!result.ok) {
            state.backendErrors = result.errors || ["Deployment start failed"];
            render();
            return;
        }
        state.currentStep = 7;
        loadArtifacts("current");
        refreshStatus();
    }).catch(function (error) {
        state.backendErrors = [String(error)];
        render();
    });
}

function cancelDeployment() {
    backendCommand("cancel").then(function () {
        refreshStatus();
    }).catch(function (error) {
        state.backendErrors = [String(error)];
        render();
    });
}

function destroyCluster(clusterId) {
    if (!window.confirm("Destroy cluster " + clusterId + "?")) {
        return;
    }
    backendCommand("destroy", ["--cluster-id", clusterId]).then(function (result) {
        if (!result.ok) {
            state.backendErrors = result.errors || ["Cluster destroy failed"];
            render();
            return;
        }
        state.currentStep = 7;
        state.artifacts = [];
        state.backendErrors = [];
        state.currentArtifactName = "";
        render();
        loadClusters();
        refreshStatus();
    }).catch(function (error) {
        state.backendErrors = [String(error)];
        render();
    });
}

function resetState() {
    stopPolling();
    var savedPools = state.availableStoragePools;
    var savedBridges = state.availableBridges;
    state = cloneState(initialState);
    state.availableStoragePools = savedPools;
    state.availableBridges = savedBridges;
    lastArtifactPreviewKey = "";
    render();
    refreshStatus();
    loadOptions();
}

function copyCurrentArtifact() {
    var artifact = currentArtifact();
    if (!artifact) {
        return;
    }
    navigator.clipboard.writeText(artifact.content).catch(function () {});
}

function downloadCurrentArtifact() {
    var artifact = currentArtifact();
    var blob;
    var href;
    var link;
    if (!artifact) {
        return;
    }
    blob = new Blob([artifact.content], { type: artifact.contentType || "text/plain" });
    href = window.URL.createObjectURL(blob);
    link = document.createElement("a");
    link.href = href;
    link.download = artifact.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(href);
}

function bindText(input, key, parser) {
    input.addEventListener("input", function (event) {
        state[key] = parser ? parser(event.target.value) : event.target.value;
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    });
}

function bindEvents() {
    bindText(refs.clusterName, "clusterName");
    bindText(refs.baseDomain, "baseDomain");
    bindText(refs.pullSecretValue, "pullSecretValue");
    bindText(refs.pullSecretFile, "pullSecretFile");
    bindText(refs.sshPublicKeyValue, "sshPublicKeyValue");
    bindText(refs.sshPublicKeyFile, "sshPublicKeyFile");
    bindText(refs.nodeVcpus, "nodeVcpus", function (value) { return parseInt(value, 10) || 0; });
    bindText(refs.nodeMemoryMb, "nodeMemoryMb", function (value) { return parseInt(value, 10) || 0; });
    bindText(refs.diskSizeGb, "diskSizeGb", function (value) { return parseInt(value, 10) || 0; });
    bindText(refs.machineCidr, "machineCidr");
    bindText(refs.machineGateway, "machineGateway");
    bindText(refs.dnsServers, "dnsServers");
    bindText(refs.controlPlaneIp1, "controlPlaneIp1");
    bindText(refs.controlPlaneIp2, "controlPlaneIp2");
    bindText(refs.controlPlaneIp3, "controlPlaneIp3");
    bindText(refs.apiVip, "apiVip");
    bindText(refs.ingressVip, "ingressVip");

    refs.openshiftVersion.addEventListener("change", function (event) {
        state.openshiftVersion = event.target.value;
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    });
    refs.cpuArchitecture.addEventListener("change", function (event) {
        state.cpuArchitecture = event.target.value;
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    });
    refs.controlPlaneCount.addEventListener("change", function (event) {
        state.controlPlaneCount = parseInt(event.target.value, 10);
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    });
    refs.bridgeName.addEventListener("change", function (event) {
        state.bridgeName = event.target.value;
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    });
    refs.storagePool.addEventListener("change", function (event) {
        state.storagePool = event.target.value;
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    });
    refs.performanceDomain.addEventListener("change", function (event) {
        state.performanceDomain = event.target.value;
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    });

    refs.networkDhcp.addEventListener("change", function (event) {
        if (event.target.checked) {
            state.hostsNetworkConfiguration = "dhcp";
            clearBackendErrors();
            render();
            scheduleArtifactPreviewRefresh(true);
        }
    });
    refs.networkStatic.addEventListener("change", function (event) {
        if (event.target.checked) {
            state.hostsNetworkConfiguration = "static";
            clearBackendErrors();
            render();
            scheduleArtifactPreviewRefresh(true);
        }
    });
    refs.encryptControlPlane.addEventListener("change", function (event) {
        state.encryptionControlPlane = event.target.checked;
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    });
    refs.encryptWorkers.addEventListener("change", function (event) {
        state.encryptionWorkers = event.target.checked;
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    });
    refs.encryptArbiter.addEventListener("change", function (event) {
        state.encryptionArbiter = event.target.checked;
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    });
    refs.yamlToggle.addEventListener("change", function (event) {
        state.yamlMode = event.target.checked;
        render();
        if (state.yamlMode) {
            scheduleArtifactPreviewRefresh(true);
        }
    });
    refs.yamlDivider.addEventListener("pointerdown", startYamlResize);

    refs.backButton.addEventListener("click", goBack);
    refs.nextButton.addEventListener("click", goNext);
    refs.deployButton.addEventListener("click", function () { startDeployment("deploy"); });
    refs.redeployButton.addEventListener("click", function () { startDeployment("redeploy"); });
    refs.stopButton.addEventListener("click", cancelDeployment);
    refs.cancelButton.addEventListener("click", resetState);
    refs.artifactCopyButton.addEventListener("click", copyCurrentArtifact);
    refs.artifactDownloadButton.addEventListener("click", downloadCurrentArtifact);
    refs.clustersRefreshButton.addEventListener("click", loadClusters);
}

function cacheRefs() {
    refs.wizardWorkspace = document.getElementById("wizard-workspace");
    refs.yamlToggle = document.getElementById("yaml-toggle");
    refs.yamlPane = document.getElementById("yaml-pane");
    refs.yamlDivider = document.getElementById("yaml-divider");
    refs.stepList = document.getElementById("step-list");
    refs.stepTitle = document.getElementById("step-title");
    refs.stepDescription = document.getElementById("step-description");
    refs.step1 = document.getElementById("step-1");
    refs.step2 = document.getElementById("step-2");
    refs.step3 = document.getElementById("step-3");
    refs.step4 = document.getElementById("step-4");
    refs.step5 = document.getElementById("step-5");
    refs.step6 = document.getElementById("step-6");
    refs.step7 = document.getElementById("step-7");

    refs.clusterNameField = document.getElementById("cluster-name-field");
    refs.clusterName = document.getElementById("cluster-name");
    refs.clusterNameError = document.getElementById("cluster-name-error");
    refs.baseDomainField = document.getElementById("base-domain-field");
    refs.baseDomain = document.getElementById("base-domain");
    refs.openshiftVersion = document.getElementById("openshift-version");
    refs.cpuArchitectureField = document.getElementById("cpu-architecture-field");
    refs.cpuArchitecture = document.getElementById("cpu-architecture");
    refs.controlPlaneCount = document.getElementById("control-plane-count");
    refs.networkDhcp = document.getElementById("network-dhcp");
    refs.networkStatic = document.getElementById("network-static");
    refs.hostsNetworkField = document.getElementById("hosts-network-field");
    refs.diskEncryptionField = document.getElementById("disk-encryption-field");
    refs.encryptControlPlane = document.getElementById("encrypt-control-plane");
    refs.encryptWorkers = document.getElementById("encrypt-workers");
    refs.encryptArbiter = document.getElementById("encrypt-arbiter");
    refs.pullSecretValueField = document.getElementById("pull-secret-value-field");
    refs.pullSecretValue = document.getElementById("pull-secret-value");
    refs.pullSecretFileField = document.getElementById("pull-secret-file-field");
    refs.pullSecretFile = document.getElementById("pull-secret-file");
    refs.sshPublicKeyValueField = document.getElementById("ssh-public-key-value-field");
    refs.sshPublicKeyValue = document.getElementById("ssh-public-key-value");
    refs.sshPublicKeyFileField = document.getElementById("ssh-public-key-file-field");
    refs.sshPublicKeyFile = document.getElementById("ssh-public-key-file");

    refs.bridgeNameField = document.getElementById("bridge-name-field");
    refs.bridgeName = document.getElementById("bridge-name");
    refs.storagePoolField = document.getElementById("storage-pool-field");
    refs.storagePool = document.getElementById("storage-pool");
    refs.nodeVcpusField = document.getElementById("node-vcpus-field");
    refs.nodeVcpus = document.getElementById("node-vcpus");
    refs.nodeMemoryMbField = document.getElementById("node-memory-mb-field");
    refs.nodeMemoryMb = document.getElementById("node-memory-mb");
    refs.diskSizeGbField = document.getElementById("disk-size-gb-field");
    refs.diskSizeGb = document.getElementById("disk-size-gb");
    refs.performanceDomain = document.getElementById("performance-domain");

    refs.machineCidrField = document.getElementById("machine-cidr-field");
    refs.machineCidr = document.getElementById("machine-cidr");
    refs.machineGatewayField = document.getElementById("machine-gateway-field");
    refs.machineGateway = document.getElementById("machine-gateway");
    refs.dnsServersField = document.getElementById("dns-servers-field");
    refs.dnsServers = document.getElementById("dns-servers");
    refs.controlPlaneIp1Field = document.getElementById("control-plane-ip-1-field");
    refs.controlPlaneIp1 = document.getElementById("control-plane-ip-1");
    refs.controlPlaneIp2Field = document.getElementById("control-plane-ip-2-field");
    refs.controlPlaneIp2 = document.getElementById("control-plane-ip-2");
    refs.controlPlaneIp3Field = document.getElementById("control-plane-ip-3-field");
    refs.controlPlaneIp3 = document.getElementById("control-plane-ip-3");
    refs.compactVipsSection = document.getElementById("compact-vips-section");
    refs.apiVipField = document.getElementById("api-vip-field");
    refs.apiVip = document.getElementById("api-vip");
    refs.ingressVipField = document.getElementById("ingress-vip-field");
    refs.ingressVip = document.getElementById("ingress-vip");
    refs.snoVipsNote = document.getElementById("sno-vips-note");

    refs.reviewList = document.getElementById("review-list");
    refs.clustersList = document.getElementById("clusters-list");
    refs.clustersRefreshButton = document.getElementById("clusters-refresh-button");
    refs.artifactTabs = document.getElementById("artifact-tabs");
    refs.artifactEmpty = document.getElementById("artifact-empty");
    refs.artifactEditor = document.getElementById("artifact-editor");
    refs.artifactLineNumbers = document.getElementById("artifact-line-numbers");
    refs.artifactContent = document.getElementById("artifact-content");
    refs.artifactCopyButton = document.getElementById("artifact-copy-button");
    refs.artifactDownloadButton = document.getElementById("artifact-download-button");
    refs.preflightAlert = document.getElementById("preflight-alert");
    refs.preflightAlertBody = document.getElementById("preflight-alert-body");
    refs.jobStatusSummary = document.getElementById("job-status-summary");
    refs.jobCurrentTask = document.getElementById("job-current-task");
    refs.installAccessCard = document.getElementById("install-access-card");
    refs.installAccessList = document.getElementById("install-access-list");
    refs.jobLog = document.getElementById("job-log");
    refs.validationAlert = document.getElementById("validation-alert");
    refs.validationAlertBody = document.getElementById("validation-alert-body");

    refs.backButton = document.getElementById("back-button");
    refs.nextButton = document.getElementById("next-button");
    refs.deployButton = document.getElementById("deploy-button");
    refs.redeployButton = document.getElementById("redeploy-button");
    refs.stopButton = document.getElementById("stop-button");
    refs.cancelButton = document.getElementById("cancel-button");
}

document.addEventListener("DOMContentLoaded", function () {
    cacheRefs();
    bindEvents();
    render();
    loadOptions();
    loadClusters();
    refreshStatus();
});
