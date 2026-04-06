"use strict";

/* global cockpit */

var HELPER_PATH = "/usr/share/cockpit/cockpit-openshift-beta/installer_backend.py";

var steps = [
    { id: 1, label: "Cluster details", description: "Define the cluster identity, installation baseline, and registry access required before host discovery." },
    { id: 2, label: "Static network configurations", description: "Define the static network model with network-wide settings, host specific definitions, and YAML-assisted editing." },
    { id: 3, label: "Operators", description: "Displayed for Assisted Installer parity, but not supported by the current local backend." },
    { id: 4, label: "Host discovery", description: "Generate discovery media, attach it to planned hosts, and verify the discovered inventory." },
    { id: 5, label: "Storage", description: "Choose the storage pool, host sizing, and installation disk layout for the local KVM-backed cluster." },
    { id: 6, label: "Networking", description: "Confirm machine networking, API and ingress VIPs, and the cluster-managed networking baseline." },
    { id: 7, label: "Review and create", description: "Validate the final configuration, inspect details if needed, and start the deployment." }
];

var operatorCatalog = [
    {
        key: "virtualization",
        title: "OpenShift Virtualization",
        description: "Run virtual machines inside the cluster after day-1 bring-up.",
        helper: "Leave unchecked for the cleanest initial install."
    },
    {
        key: "ai",
        title: "OpenShift AI",
        description: "GPU and model-serving platform services for later expansion.",
        helper: "Best introduced after the cluster is healthy."
    },
    {
        key: "serviceMesh",
        title: "Service Mesh",
        description: "Cluster-wide traffic management and observability add-ons.",
        helper: "Keep disabled during the initial assisted install."
    }
];

var refs = {};
var state = createInitialState();
var pollTimer = null;
var artifactPreviewTimer = null;
var lastArtifactPreviewKey = "";
var pageContext = "";

function defaultHostNames(count) {
    if (count === 1) {
        return ["ocp-control-01"];
    }
    return ["ocp-master-01", "ocp-master-02", "ocp-master-03"];
}

function defaultOperatorState() {
    return {
        virtualization: false,
        ai: false,
        serviceMesh: false
    };
}

function buildDefaultHosts(count) {
    return defaultHostNames(count).map(function (name) {
        return {
            name: name,
            macAddress: "",
            ipAddress: "",
            networkYaml: "",
            networkYamlCustomized: false
        };
    });
}

function createInitialState() {
    return {
        wizardOpen: false,
        currentStep: 1,
        step2Section: "network-wide",
        yamlMode: false,
        yamlPaneWidth: 560,
        clusterName: "",
        baseDomain: "ocp.lab",
        openshiftVersion: "OpenShift 4.21.7",
        cpuArchitecture: "x86_64",
        controlPlaneCount: 3,
        hostsNetworkConfiguration: "static",
        partnerIntegration: "none",
        pullSecretValue: "",
        pullSecretFile: "",
        sshPublicKeyValue: "",
        sshPublicKeyFile: "",
        bridgeName: "",
        secondaryBridgeName: "",
        primaryInterfaceName: "eth0",
        secondaryInterfaceName: "eth1",
        privateVlanId: "",
        nodeVcpus: 10,
        nodeMemoryMb: 16384,
        diskSizeGb: 120,
        storagePool: "",
        performanceDomain: "none",
        machineCidr: "",
        machineGateway: "",
        dnsServers: "",
        apiVip: "",
        ingressVip: "",
        hosts: buildDefaultHosts(3),
        operators: defaultOperatorState(),
        availableBridges: [],
        availableStoragePools: [],
        artifacts: [],
        currentArtifactName: "",
        clusters: [],
        backendErrors: [],
        job: null,
        showKubeadminPassword: false
    };
}

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
    return cockpit.spawn(args, { superuser: "require", err: "message" }).then(function (output) {
        return JSON.parse(output);
    });
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
    var maxWidth = Math.max(540, Math.floor(workspaceWidth * 0.5));
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

function selectedOperators() {
    return operatorCatalog.filter(function (entry) {
        return !!state.operators[entry.key];
    }).map(function (entry) {
        return entry.title;
    });
}

function dnsServerList() {
    return state.dnsServers.split(",").map(function (entry) {
        return entry.trim();
    }).filter(function (entry) {
        return entry.length > 0;
    });
}

function activeJobClusterId() {
    if (!state.job || !state.job.state || !state.job.state.clusterName || !state.job.state.baseDomain) {
        return "";
    }
    return state.job.state.clusterName + "." + state.job.state.baseDomain;
}

function draftClusterId() {
    if (!state.clusterName.trim() || !state.baseDomain.trim()) {
        return "";
    }
    return state.clusterName.trim() + "." + state.baseDomain.trim();
}

function discoveryMediaPath() {
    if (!state.clusterName.trim()) {
        return "Will be generated after the cluster name is set.";
    }
    return "/var/lib/libvirt/images/" + state.clusterName.trim() + "-agent.x86_64.iso";
}

function syncHostCount() {
    var defaults = buildDefaultHosts(state.controlPlaneCount);
    var nextHosts = [];

    defaults.forEach(function (entry, index) {
        var existing = state.hosts[index] || {};
        nextHosts.push({
            name: existing.name || entry.name,
            macAddress: existing.macAddress || "",
            ipAddress: existing.ipAddress || "",
            networkYaml: existing.networkYaml || "",
            networkYamlCustomized: !!existing.networkYamlCustomized
        });
    });

    state.hosts = nextHosts;
}

function cidrPrefixLength() {
    var raw = state.machineCidr.trim();
    var match = raw.match(/\/(\d{1,2})$/);
    return match ? match[1] : "";
}

function generateHostNetworkYaml(host) {
    var iface = state.primaryInterfaceName.trim() || "eth0";
    var vlanId = state.privateVlanId.trim();
    var vlanInterface = vlanId ? iface + "." + vlanId : "";
    var addressInterface = vlanInterface || iface;
    var prefix = cidrPrefixLength();
    var lines = [
        "interfaces:",
        "  - name: " + iface,
        "    type: ethernet",
        "    state: up",
        "    ipv4:",
        "      enabled: " + (vlanId ? "false" : "true"),
        "      dhcp: false"
    ];

    if (!vlanId) {
        if (host.ipAddress.trim() && prefix) {
            lines = lines.concat([
                "      address:",
                "        - ip: " + host.ipAddress.trim(),
                "          prefix-length: " + prefix
            ]);
        } else {
            lines.push("      address: []");
        }
        lines = lines.concat([
            "    ipv6:",
            "      enabled: false"
        ]);
    }

    if (vlanId) {
        lines = lines.concat([
            "    ipv6:",
            "      enabled: false",
            "  - name: " + iface + "." + vlanId,
            "    type: vlan",
            "    state: up",
            "    vlan:",
            "      base-iface: " + iface,
            "      id: " + vlanId,
            "    ipv4:",
            "      enabled: true",
            "      dhcp: false"
        ]);
        if (host.ipAddress.trim() && prefix) {
            lines = lines.concat([
                "      address:",
                "        - ip: " + host.ipAddress.trim(),
                "          prefix-length: " + prefix
            ]);
        } else {
            lines.push("      address: []");
        }
        lines = lines.concat([
            "    ipv6:",
            "      enabled: false"
        ]);
    }

    if (dnsServerList().length > 0) {
        lines = lines.concat([
            "dns-resolver:",
            "  config:",
            "    server:"
        ]);
        dnsServerList().forEach(function (server) {
            lines.push("      - " + server);
        });
    }

    if (state.machineGateway.trim()) {
        lines = lines.concat([
            "routes:",
            "  config:",
            "    - destination: 0.0.0.0/0",
            "      next-hop-address: " + state.machineGateway.trim(),
            "      next-hop-interface: " + addressInterface,
            "      table-id: 254"
        ]);
    }

    return lines.join("\n");
}

function syncGeneratedHostYaml() {
    syncHostCount();
    state.hosts = state.hosts.map(function (host) {
        if (!host.networkYamlCustomized || !host.networkYaml.trim()) {
            host.networkYaml = generateHostNetworkYaml(host);
        }
        return host;
    });
}

function payload() {
    return {
        clusterName: state.clusterName.trim(),
        baseDomain: state.baseDomain.trim(),
        openshiftVersion: state.openshiftVersion,
        cpuArchitecture: state.cpuArchitecture,
        controlPlaneCount: state.controlPlaneCount,
        partnerIntegration: state.partnerIntegration,
        hostsNetworkConfiguration: state.hostsNetworkConfiguration,
        pullSecretValue: state.pullSecretValue,
        pullSecretFile: state.pullSecretFile.trim(),
        sshPublicKeyValue: state.sshPublicKeyValue,
        sshPublicKeyFile: state.sshPublicKeyFile.trim(),
        bridgeName: state.bridgeName,
        secondaryBridgeName: state.secondaryBridgeName,
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
            apiVip: state.apiVip.trim(),
            ingressVip: state.ingressVip.trim(),
            primaryInterfaceName: state.primaryInterfaceName.trim(),
            secondaryInterfaceName: state.secondaryInterfaceName.trim(),
            privateVlanId: state.privateVlanId.trim()
        },
        hosts: state.hosts.map(function (host) {
            return {
                name: host.name.trim(),
                role: "control-plane",
                macAddress: host.macAddress.trim(),
                ipAddress: host.ipAddress.trim(),
                networkYaml: host.networkYaml
            };
        }),
        operators: selectedOperators()
    };
}

function artifactPreviewKey() {
    if (!state.yamlMode || !state.wizardOpen) {
        return "";
    }
    if (state.job && state.job.state && state.job.state.mode === "destroy") {
        return "destroy";
    }
    return JSON.stringify(payload());
}

function scheduleArtifactPreviewRefresh(force) {
    var key;

    if (!state.yamlMode || !state.wizardOpen || (state.job && state.job.state && state.job.state.mode === "destroy")) {
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
    state.secondaryBridgeName = request.network && request.network.secondaryBridgeName ? request.network.secondaryBridgeName : "";
    state.performanceDomain = request.compute && request.compute.performanceDomain ? request.compute.performanceDomain : state.performanceDomain;
    state.nodeVcpus = request.compute && request.compute.nodeVcpus ? request.compute.nodeVcpus : state.nodeVcpus;
    state.nodeMemoryMb = request.compute && request.compute.nodeMemoryMb ? request.compute.nodeMemoryMb : state.nodeMemoryMb;
    state.storagePool = request.storage && request.storage.storagePool ? request.storage.storagePool : state.storagePool;
    state.diskSizeGb = request.storage && request.storage.diskSizeGb ? request.storage.diskSizeGb : state.diskSizeGb;
    state.machineCidr = request.network && request.network.machineCidr ? request.network.machineCidr : state.machineCidr;
    state.machineGateway = request.network && request.network.machineGateway ? request.network.machineGateway : state.machineGateway;
    state.dnsServers = request.network && request.network.dnsServers ? request.network.dnsServers.join(", ") : state.dnsServers;
    state.apiVip = request.network && request.network.apiVip ? request.network.apiVip : state.apiVip;
    state.ingressVip = request.network && request.network.ingressVip ? request.network.ingressVip : state.ingressVip;
    state.primaryInterfaceName = request.network && request.network.primaryInterfaceName ? request.network.primaryInterfaceName : state.primaryInterfaceName;
    state.secondaryInterfaceName = request.network && request.network.secondaryInterfaceName ? request.network.secondaryInterfaceName : state.secondaryInterfaceName;
    state.privateVlanId = request.network && request.network.privateVlanId ? request.network.privateVlanId : state.privateVlanId;
    state.partnerIntegration = request.partnerIntegration || state.partnerIntegration;

    if (request.hosts && request.hosts.length) {
        state.hosts = request.hosts.map(function (host) {
            return {
                name: host.name || "",
                macAddress: host.macAddress || "",
                ipAddress: host.ipAddress || "",
                networkYaml: host.networkYaml || "",
                networkYamlCustomized: false
            };
        });
    } else {
        syncHostCount();
    }

    if (request.secretInputs) {
        state.pullSecretFile = request.secretInputs.pullSecretSource === "file" ? (request.secretInputs.pullSecretFile || "") : "";
        state.sshPublicKeyFile = request.secretInputs.sshPublicKeySource === "file" ? (request.secretInputs.sshPublicKeyFile || "") : "";
    }

    if (request.operators && request.operators.length) {
        state.operators = defaultOperatorState();
        operatorCatalog.forEach(function (entry) {
            state.operators[entry.key] = request.operators.indexOf(entry.title) >= 0;
        });
    }

    syncGeneratedHostYaml();
}

function currentStepMeta() {
    return steps[state.currentStep - 1];
}

function stepErrorsFor(stepId) {
    var errors = [];

    if (stepId === 1) {
        if (!state.clusterName.trim()) errors.push("Cluster name");
        if (!state.baseDomain.trim()) errors.push("Base domain");
        if (state.cpuArchitecture !== "x86_64") errors.push("CPU architecture");
        if (!state.pullSecretValue.trim() && !state.pullSecretFile.trim()) errors.push("Pull secret");
    }

    if (stepId === 2) {
        if (!state.bridgeName) errors.push("Primary bridge");
        if (!state.primaryInterfaceName.trim()) errors.push("Primary guest interface name");
        if (state.secondaryBridgeName && !state.secondaryInterfaceName.trim()) errors.push("Secondary guest interface name");
        if (state.secondaryBridgeName && state.secondaryBridgeName === state.bridgeName) errors.push("Secondary bridge must differ from primary bridge");
        state.hosts.forEach(function (host, index) {
            if (!host.name.trim()) errors.push("Host " + (index + 1) + " name");
            if (!host.macAddress.trim()) errors.push("Host " + (index + 1) + " MAC address");
            if (!host.ipAddress.trim()) errors.push("Host " + (index + 1) + " private IP");
            if (!host.networkYaml.trim()) errors.push("Host " + (index + 1) + " network YAML");
        });
    }

    if (stepId === 4) {
        if (!state.sshPublicKeyValue.trim() && !state.sshPublicKeyFile.trim()) errors.push("SSH public key");
    }

    if (stepId === 5) {
        if (!state.storagePool) errors.push("Storage pool");
        if (!(parseInt(state.nodeVcpus, 10) > 0)) errors.push("Control plane vCPU count");
        if (!(parseInt(state.nodeMemoryMb, 10) > 0)) errors.push("Control plane memory");
        if (!(parseInt(state.diskSizeGb, 10) > 0)) errors.push("Installation disk size");
    }

    if (stepId === 6) {
        if (!state.machineCidr.trim()) errors.push("Machine network CIDR");
        if (state.controlPlaneCount === 3 && !state.apiVip.trim()) errors.push("API VIP");
        if (state.controlPlaneCount === 3 && !state.ingressVip.trim()) errors.push("Ingress VIP");
    }

    return errors;
}

function currentStepErrors() {
    return stepErrorsFor(state.currentStep);
}

function furthestAvailableStep() {
    var stepId;

    for (stepId = 1; stepId < steps.length; stepId += 1) {
        if (stepErrorsFor(stepId).length > 0) {
            return stepId;
        }
    }
    return steps.length;
}

function overallErrors() {
    var all = [];
    var seen = {};
    var stepId;

    for (stepId = 1; stepId <= steps.length; stepId += 1) {
        stepErrorsFor(stepId).forEach(function (entry) {
            if (!seen[entry]) {
                seen[entry] = true;
                all.push(entry);
            }
        });
    }

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
    setFieldInvalid(refs.cpuArchitecture, refs.cpuArchitectureField, errors.indexOf("CPU architecture") >= 0);
    setFieldInvalid(refs.bridgeName, refs.bridgeNameField, errors.indexOf("Primary bridge") >= 0);
    setFieldInvalid(refs.secondaryBridgeName, refs.secondaryBridgeNameField, errors.indexOf("Secondary bridge must differ from primary bridge") >= 0);
    setFieldInvalid(refs.sshPublicKeyValue, refs.sshPublicKeyValueField, errors.indexOf("SSH public key") >= 0);
    setFieldInvalid(refs.sshPublicKeyFile, refs.sshPublicKeyFileField, errors.indexOf("SSH public key") >= 0);
    setFieldInvalid(refs.storagePool, refs.storagePoolField, errors.indexOf("Storage pool") >= 0);
    setFieldInvalid(refs.nodeVcpus, refs.nodeVcpusField, errors.indexOf("Control plane vCPU count") >= 0);
    setFieldInvalid(refs.nodeMemoryMb, refs.nodeMemoryMbField, errors.indexOf("Control plane memory") >= 0);
    setFieldInvalid(refs.diskSizeGb, refs.diskSizeGbField, errors.indexOf("Installation disk size") >= 0);
    setFieldInvalid(refs.machineCidr, refs.machineCidrField, errors.indexOf("Machine network CIDR") >= 0);
    setFieldInvalid(refs.apiVip, refs.apiVipField, errors.indexOf("API VIP") >= 0);
    setFieldInvalid(refs.ingressVip, refs.ingressVipField, errors.indexOf("Ingress VIP") >= 0);

    refs.clusterNameError.hidden = errors.indexOf("Cluster name") < 0;
}

function renderValidationAlert() {
    var errors = currentStepErrors();
    var reviewErrors = overallErrors();
    var shouldShowStepAlert = errors.length > 0 && state.currentStep !== 7;
    var shouldShowReviewAlert = state.currentStep === 7 && reviewErrors.length > 0;

    refs.validationAlert.hidden = !(shouldShowStepAlert || shouldShowReviewAlert);
    if (shouldShowReviewAlert) {
        refs.validationAlertBody.textContent = "The following fields are invalid or missing: " + reviewErrors.join(", ") + ".";
    } else if (shouldShowStepAlert) {
        refs.validationAlertBody.textContent = "The following fields are invalid or missing: " + errors.join(", ") + ".";
    } else {
        refs.validationAlertBody.textContent = "";
    }

    refs.preflightAlert.hidden = !shouldShowReviewAlert;
    refs.preflightAlertBody.textContent = refs.preflightAlert.hidden
        ? ""
        : "The following fields are invalid or missing: " + reviewErrors.join(", ") + ".";
}

function renderStepList() {
    var availableStep = furthestAvailableStep();

    refs.stepList.innerHTML = "";
    steps.forEach(function (step) {
        var item = document.createElement("li");
        var classes = ["wizard-step"];
        var canClick = step.id <= availableStep || step.id < state.currentStep || state.currentStep === 7;

        if (step.id === state.currentStep) {
            classes.push("wizard-step--active");
            if (step.id === 3) {
                classes.push("wizard-step--unsupported");
            }
        } else if (step.id < state.currentStep || step.id < availableStep) {
            classes.push("wizard-step--complete");
            if (step.id === 3) {
                classes.push("wizard-step--unsupported");
            }
        } else {
            classes.push("wizard-step--disabled");
            if (step.id === 3) {
                classes.push("wizard-step--unsupported");
            }
        }

        if (canClick) {
            classes.push("wizard-step--clickable");
            item.addEventListener("click", function () {
                state.currentStep = step.id;
                render();
            });
        }

        item.className = classes.join(" ");
        item.setAttribute("aria-current", step.id === state.currentStep ? "step" : "false");

        var num = document.createElement("span");
        num.className = "wizard-step__number";
        num.textContent = String(step.id);
        var labelWrap = document.createElement("span");
        labelWrap.className = "wizard-step__copy";
        var label = document.createElement("span");
        label.className = "wizard-step__label";
        label.textContent = step.label;
        var description = document.createElement("span");
        description.className = "wizard-step__description";
        description.textContent = step.description;

        labelWrap.appendChild(label);
        labelWrap.appendChild(description);
        item.appendChild(num);
        item.appendChild(labelWrap);
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

function renderStep2Layout() {
    var onNetworkWide = state.step2Section === "network-wide";

    if (!refs.networkWideTab) {
        return;
    }

    refs.networkWideTab.classList.toggle("step-subnav__button--active", onNetworkWide);
    refs.networkWideTab.toggleAttribute("aria-current", onNetworkWide);
    refs.hostSpecificTab.classList.toggle("step-subnav__button--active", !onNetworkWide);
    refs.hostSpecificTab.toggleAttribute("aria-current", !onNetworkWide);
    refs.step2NetworkWidePanel.hidden = !onNetworkWide;
    refs.step2HostSpecificPanel.hidden = onNetworkWide;

    refs.formViewButton.classList.toggle("view-switch__button--active", !state.yamlMode);
    refs.formViewButton.setAttribute("aria-pressed", String(!state.yamlMode));
    refs.yamlViewButton.classList.toggle("view-switch__button--active", state.yamlMode);
    refs.yamlViewButton.setAttribute("aria-pressed", String(state.yamlMode));
}

function renderTopology() {
    var compact = state.controlPlaneCount === 3;
    refs.compactVipsSection.hidden = !compact;
    refs.snoVipsNote.hidden = compact;
}

function renderSelectOptions(select, values, selected) {
    select.innerHTML = "";
    values.forEach(function (value) {
        var option = document.createElement("option");
        option.value = value.value;
        option.textContent = value.label;
        option.disabled = !!value.disabled;
        if (option.value === selected) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function renderOptions() {
    var poolOptions = state.availableStoragePools.map(function (pool) {
        return {
            value: pool.name,
            label: pool.name + " (" + pool.type + ", " + (pool.active ? "active" : "inactive") + ")",
            disabled: !pool.supported
        };
    });
    if (poolOptions.length === 0) {
        poolOptions = [{ value: "", label: "No supported storage pools found", disabled: true }];
    }
    renderSelectOptions(refs.storagePool, poolOptions, state.storagePool);

    var primaryBridgeOptions = state.availableBridges.length > 0
        ? state.availableBridges.map(function (bridge) {
            return { value: bridge, label: bridge, disabled: false };
        })
        : [{ value: "", label: "No bridges found", disabled: true }];
    renderSelectOptions(refs.bridgeName, primaryBridgeOptions, state.bridgeName);

    var secondaryBridgeOptions = [{ value: "", label: "No secondary bridge", disabled: false }];
    state.availableBridges.forEach(function (bridge) {
        secondaryBridgeOptions.push({ value: bridge, label: bridge, disabled: false });
    });
    renderSelectOptions(refs.secondaryBridgeName, secondaryBridgeOptions, state.secondaryBridgeName);
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

function jobDrivenDeploymentCard() {
    if (!state.job || !state.job.state || state.job.state.mode === "destroy") {
        return null;
    }
    if (!state.job.running && !state.job.state.status) {
        return null;
    }
    return {
        id: activeJobClusterId() || "active-job",
        title: activeJobClusterId() || "Pending deployment",
        subtitle: state.job.running ? "Deployment in progress" : "Recent deployment activity",
        status: state.job.state.status || "running",
        currentTask: state.job.currentTask || "",
        cluster: null,
        synthetic: true
    };
}

function deploymentCollections() {
    var deploying = [];
    var deployed = [];
    var activeId = activeJobClusterId();
    var synthetic = jobDrivenDeploymentCard();

    state.clusters.forEach(function (cluster) {
        var active = activeId && cluster.clusterId === activeId;
        if (active || !cluster.health || !cluster.health.available) {
            deploying.push({
                id: cluster.clusterId,
                title: cluster.clusterName + "." + cluster.baseDomain,
                subtitle: clusterStatusLabel(cluster),
                status: clusterStatusLabel(cluster),
                currentTask: active && state.job ? (state.job.currentTask || "") : "",
                cluster: cluster,
                synthetic: false
            });
        } else {
            deployed.push({
                id: cluster.clusterId,
                title: cluster.clusterName + "." + cluster.baseDomain,
                subtitle: clusterStatusLabel(cluster),
                status: clusterStatusLabel(cluster),
                currentTask: "",
                cluster: cluster,
                synthetic: false
            });
        }
    });

    if (synthetic && !deploying.some(function (item) { return item.id === synthetic.id; })) {
        deploying.unshift(synthetic);
    }

    return {
        deploying: deploying,
        deployed: deployed
    };
}

function clusterStatusLabel(cluster) {
    if (state.job && state.job.running && cluster.clusterId === activeJobClusterId()) {
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

function renderManagementSummary() {
    if (!refs.summaryDeployedCount || !refs.summaryDeployingCount) {
        return;
    }
    var collections = deploymentCollections();
    refs.summaryDeployedCount.textContent = String(collections.deployed.length);
    refs.summaryDeployingCount.textContent = String(collections.deploying.length);
}

function renderClusterCard(item, container) {
    var card = document.createElement("article");
    var header = document.createElement("div");
    var titleWrap = document.createElement("div");
    var title = document.createElement("h3");
    var subtitle = document.createElement("p");
    var status = document.createElement("span");
    var details = document.createElement("dl");
    var actions = document.createElement("div");
    var continueButton = document.createElement("button");

    card.className = "cluster-card";
    header.className = "cluster-card__header";
    titleWrap.className = "cluster-card__copy";
    title.className = "cluster-card__title";
    subtitle.className = "cluster-card__meta";
    status.className = "status-chip";
    details.className = "review-list review-list--compact";
    actions.className = "artifact-actions";

    title.textContent = item.title;
    subtitle.textContent = item.currentTask || item.subtitle;
    status.textContent = item.status;
    status.classList.add(item.status === "Available" ? "status-chip--success" : "status-chip--progress");

    continueButton.type = "button";
    continueButton.className = "action-button action-button--secondary";
    continueButton.textContent = item.cluster ? "Open flow" : "Continue deployment";
    continueButton.addEventListener("click", function () {
        state.wizardOpen = true;
        if (state.job && state.job.state && state.job.state.status === "succeeded") {
            state.currentStep = 7;
        } else if (state.job && state.job.running) {
            state.currentStep = 7;
        }
        render();
        scheduleArtifactPreviewRefresh(true);
    });

    actions.appendChild(continueButton);

    if (item.cluster && item.cluster.consoleUrl) {
        var consoleLink = document.createElement("a");
        consoleLink.className = "action-button action-button--secondary";
        consoleLink.href = item.cluster.consoleUrl;
        consoleLink.target = "_blank";
        consoleLink.rel = "noopener noreferrer";
        consoleLink.textContent = "Console";
        actions.appendChild(consoleLink);
    }

    if (item.cluster) {
        var destroyButton = document.createElement("button");
        destroyButton.type = "button";
        destroyButton.className = "action-button action-button--secondary action-button--danger";
        destroyButton.textContent = "Destroy";
        destroyButton.disabled = state.job && state.job.running;
        destroyButton.addEventListener("click", function () {
            destroyCluster(item.cluster.clusterId);
        });
        actions.appendChild(destroyButton);
    }

    header.appendChild(titleWrap);
    header.appendChild(actions);
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);
    titleWrap.appendChild(status);

    if (item.cluster) {
        [
            ["Topology", item.cluster.topology],
            ["Nodes", String(item.cluster.health && item.cluster.health.totalNodes ? item.cluster.health.totalNodes : item.cluster.nodeCount)],
            ["Ready", item.cluster.health ? (item.cluster.health.readyNodes + "/" + item.cluster.health.totalNodes) : "Unknown"],
            ["Kubeconfig", item.cluster.kubeconfigPath || "Not available"]
        ].forEach(function (row) {
            var dt = document.createElement("dt");
            var dd = document.createElement("dd");
            dt.textContent = row[0];
            dd.textContent = row[1];
            details.appendChild(dt);
            details.appendChild(dd);
        });
    } else {
        [
            ["Cluster", item.title],
            ["Status", item.status],
            ["Current task", item.currentTask || "Waiting for deployment output"]
        ].forEach(function (row) {
            var dt = document.createElement("dt");
            var dd = document.createElement("dd");
            dt.textContent = row[0];
            dd.textContent = row[1];
            details.appendChild(dt);
            details.appendChild(dd);
        });
    }

    card.appendChild(header);
    card.appendChild(details);
    container.appendChild(card);
}

function renderClusterCollections() {
    if (!refs.deployingClustersList || !refs.deployedClustersList || !refs.deployingClustersEmpty || !refs.deployedClustersEmpty) {
        return;
    }
    var collections = deploymentCollections();

    refs.deployingClustersList.innerHTML = "";
    refs.deployedClustersList.innerHTML = "";
    refs.deployingClustersEmpty.hidden = collections.deploying.length > 0;
    refs.deployedClustersEmpty.hidden = collections.deployed.length > 0;

    collections.deploying.forEach(function (item) {
        renderClusterCard(item, refs.deployingClustersList);
    });
    collections.deployed.forEach(function (item) {
        renderClusterCard(item, refs.deployedClustersList);
    });
}

function renderOperatorSelection() {
    refs.operatorSelectionList.innerHTML = "";
    operatorCatalog.forEach(function (entry) {
        var card = document.createElement("label");
        var checkbox = document.createElement("input");
        var body = document.createElement("div");
        var title = document.createElement("div");
        var description = document.createElement("div");
        var helper = document.createElement("div");

        card.className = "operator-card operator-card--disabled";
        checkbox.type = "checkbox";
        checkbox.checked = !!state.operators[entry.key];
        checkbox.disabled = true;

        body.className = "operator-card__body";
        title.className = "operator-card__title";
        description.className = "body-copy";
        helper.className = "field-helper";

        title.textContent = entry.title;
        description.textContent = entry.description;
        helper.textContent = entry.helper;

        body.appendChild(title);
        body.appendChild(description);
        body.appendChild(helper);
        card.appendChild(checkbox);
        card.appendChild(body);
        refs.operatorSelectionList.appendChild(card);
    });
}

function renderPreservingFocus(fieldId, selectionStart, selectionEnd) {
    var field;

    render();

    if (!fieldId) {
        return;
    }

    field = document.getElementById(fieldId);
    if (!field) {
        return;
    }

    field.focus();
    if (typeof selectionStart === "number" && typeof selectionEnd === "number" && typeof field.setSelectionRange === "function") {
        field.setSelectionRange(selectionStart, selectionEnd);
    }
}

function renderHostDefinitions() {
    var errors = currentStepErrors();

    refs.hostDefinitionList.innerHTML = "";
    state.hosts.forEach(function (host, index) {
        var card = document.createElement("article");
        var header = document.createElement("div");
        var title = document.createElement("h4");
        var chip = document.createElement("span");
        var fields = document.createElement("div");
        var nameField = document.createElement("div");
        var nameLabel = document.createElement("label");
        var nameInput = document.createElement("input");
        var macField = document.createElement("div");
        var macLabel = document.createElement("label");
        var macInput = document.createElement("input");
        var ipField = document.createElement("div");
        var ipLabel = document.createElement("label");
        var ipInput = document.createElement("input");

        card.className = "host-definition-card";
        header.className = "host-definition-card__header";
        title.className = "section-title section-title--small";
        chip.className = "status-chip status-chip--muted";
        fields.className = "host-definition-card__grid";

        title.textContent = "Host " + (index + 1);
        chip.textContent = state.controlPlaneCount === 1 ? "Single control plane" : "Control plane";

        nameField.className = "form-field" + (errors.indexOf("Host " + (index + 1) + " name") >= 0 ? " is-invalid" : "");
        nameLabel.className = "field-label";
        nameLabel.textContent = "Hostname";
        nameLabel.htmlFor = "host-name-" + index;
        nameInput.className = "text-input";
        nameInput.id = "host-name-" + index;
        nameInput.value = host.name;
        nameInput.addEventListener("input", function (event) {
            host.name = event.target.value;
            renderPreservingFocus(nameInput.id, event.target.selectionStart, event.target.selectionEnd);
            scheduleArtifactPreviewRefresh(true);
        });

        macField.className = "form-field" + (errors.indexOf("Host " + (index + 1) + " MAC address") >= 0 ? " is-invalid" : "");
        macLabel.className = "field-label";
        macLabel.textContent = "Primary NIC MAC address";
        macLabel.htmlFor = "host-mac-" + index;
        macInput.className = "text-input";
        macInput.id = "host-mac-" + index;
        macInput.value = host.macAddress;
        macInput.addEventListener("input", function (event) {
            host.macAddress = event.target.value;
            renderPreservingFocus(macInput.id, event.target.selectionStart, event.target.selectionEnd);
            scheduleArtifactPreviewRefresh(true);
        });

        ipField.className = "form-field" + (errors.indexOf("Host " + (index + 1) + " private IP") >= 0 ? " is-invalid" : "");
        ipLabel.className = "field-label";
        ipLabel.textContent = "Private cluster IP";
        ipLabel.htmlFor = "host-ip-" + index;
        ipInput.className = "text-input";
        ipInput.id = "host-ip-" + index;
        ipInput.value = host.ipAddress;
        ipInput.addEventListener("input", function (event) {
            host.ipAddress = event.target.value;
            if (!host.networkYamlCustomized) {
                host.networkYaml = generateHostNetworkYaml(host);
            }
            renderPreservingFocus(ipInput.id, event.target.selectionStart, event.target.selectionEnd);
            scheduleArtifactPreviewRefresh(true);
        });

        nameField.appendChild(nameLabel);
        nameField.appendChild(nameInput);
        macField.appendChild(macLabel);
        macField.appendChild(macInput);
        ipField.appendChild(ipLabel);
        ipField.appendChild(ipInput);

        fields.appendChild(nameField);
        fields.appendChild(ipField);
        fields.appendChild(macField);
        header.appendChild(title);
        header.appendChild(chip);
        card.appendChild(header);
        card.appendChild(fields);
        refs.hostDefinitionList.appendChild(card);
    });
}

function hostDiscoveryStatus(host) {
    var cluster = state.clusters.find(function (entry) {
        return entry.clusterId === draftClusterId();
    });
    var domainName = host.name + "." + draftClusterId();
    var hostIdentity = (host.macAddress || "MAC not set") + " / " + (host.ipAddress || "Private IP not set");
    if (cluster && cluster.domains && cluster.domains.indexOf(domainName) >= 0) {
        if (cluster.health && cluster.health.totalNodes > 0) {
            return { label: "Ready for install", tone: "status-chip--success", detail: hostIdentity };
        }
        return { label: "Discovered", tone: "status-chip--progress", detail: hostIdentity };
    }
    if (state.job && state.job.running && activeJobClusterId() === draftClusterId()) {
        return { label: "Waiting for discovery", tone: "status-chip--warning", detail: "Confirm the discovery ISO is attached and the guest is booted." };
    }
    if (!host.ipAddress || !host.networkYaml.trim()) {
        return { label: "Needs attention", tone: "status-chip--danger", detail: "Complete the static host definition before discovery starts." };
    }
    return { label: "Planned", tone: "status-chip--muted", detail: "Static network definition is ready for discovery media attachment." };
}

function renderHostDiscovery() {
    refs.hostDiscoveryList.innerHTML = "";
    state.hosts.forEach(function (host) {
        var card = document.createElement("div");
        var title = document.createElement("div");
        var meta = document.createElement("div");
        var status = document.createElement("span");
        var statusMeta = hostDiscoveryStatus(host);

        card.className = "discovery-host-card";
        title.className = "discovery-host-card__title";
        meta.className = "field-helper";
        status.className = "status-chip " + statusMeta.tone;

        title.textContent = host.name || "Unnamed host";
        meta.textContent = statusMeta.detail;
        status.textContent = statusMeta.label;

        card.appendChild(title);
        card.appendChild(meta);
        card.appendChild(status);
        refs.hostDiscoveryList.appendChild(card);
    });
}

function reviewGroups() {
    return [
        {
            title: "Cluster definition",
            rows: [
                ["Cluster", (state.clusterName.trim() || "Not set") + "." + (state.baseDomain.trim() || "Not set")],
                ["Topology", state.controlPlaneCount === 1 ? "Single-node assisted install" : "Compact 3-node assisted install"],
                ["OpenShift version", state.openshiftVersion],
                ["Partner integration", state.partnerIntegration === "none" ? "No platform integration" : state.partnerIntegration],
                ["Pull secret", state.pullSecretValue.trim() ? "Pasted into form" : (state.pullSecretFile.trim() || "Not set")]
            ]
        },
        {
            title: "Host and network definition",
            rows: [
                ["Primary bridge", state.bridgeName || "Not set"],
                ["Secondary bridge", state.secondaryBridgeName || "Not attached"],
                ["Primary guest NIC", state.primaryInterfaceName || "Not set"],
                ["Secondary guest NIC", state.secondaryInterfaceName || "Not set"],
                ["Private VLAN ID", state.privateVlanId || "Not set"],
                ["Hosts", state.hosts.map(function (host) { return (host.name || "host") + " (" + (host.macAddress || "MAC not set") + ", " + (host.ipAddress || "IP not set") + ")"; }).join(", ") || "Not set"]
            ]
        },
        {
            title: "Operators and discovery",
            rows: [
                ["Operators", "Displayed for workflow parity only; day-1 activation remains disabled in the local backend"],
                ["SSH public key", state.sshPublicKeyValue.trim() ? "Pasted into form" : (state.sshPublicKeyFile.trim() || "Not set")],
                ["Discovery media", discoveryMediaPath()]
            ]
        },
        {
            title: "Storage and networking",
            rows: [
                ["Storage pool", state.storagePool || "Not set"],
                ["Installation disk", (state.diskSizeGb ? String(state.diskSizeGb) : "Not set") + " GiB"],
                ["Control plane sizing", String(state.nodeVcpus) + " vCPU / " + String(state.nodeMemoryMb) + " MiB"],
                ["Machine CIDR", state.machineCidr.trim() || "Not set"],
                ["DNS servers", dnsServerList().join(", ") || "Not set"],
                ["API / ingress VIPs", state.controlPlaneCount === 1 ? "Rendered to the single control plane node" : ((state.apiVip.trim() || "Not set") + " / " + (state.ingressVip.trim() || "Not set"))]
            ]
        },
    ];
}

function renderReview() {
    refs.reviewSections.innerHTML = "";
    reviewGroups().forEach(function (group) {
        var card = document.createElement("section");
        var title = document.createElement("h5");
        var list = document.createElement("dl");

        card.className = "review-group";
        title.className = "section-title section-title--small";
        list.className = "review-list review-list--compact";
        title.textContent = group.title;

        group.rows.forEach(function (row) {
            var dt = document.createElement("dt");
            var dd = document.createElement("dd");
            dt.textContent = row[0];
            dd.textContent = row[1];
            list.appendChild(dt);
            list.appendChild(dd);
        });

        card.appendChild(title);
        card.appendChild(list);
        refs.reviewSections.appendChild(card);
    });
}

function createPasswordValue(password) {
    var wrapper = document.createElement("div");
    var value = document.createElement("span");
    var toggle = document.createElement("button");
    var label = state.showKubeadminPassword ? "Hide password" : "Show password";
    var displayValue = state.showKubeadminPassword ? password : "\u2022".repeat(Math.max(password.length, 12));

    wrapper.className = "secret-field";
    value.className = "secret-field__value";
    value.textContent = displayValue;
    toggle.type = "button";
    toggle.className = "secret-field__toggle";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.textContent = state.showKubeadminPassword ? "Hide" : "Show";
    toggle.addEventListener("click", function () {
        state.showKubeadminPassword = !state.showKubeadminPassword;
        renderJob();
        renderPostInstall();
    });
    wrapper.appendChild(value);
    wrapper.appendChild(toggle);
    return wrapper;
}

function renderJob() {
    if (!state.job) {
        refs.jobStatusSummary.textContent = "No deployment has been started yet.";
        refs.jobCurrentTask.textContent = "";
        refs.jobLog.textContent = "No log output yet.";
        refs.installAccessCard.hidden = true;
        refs.installAccessList.innerHTML = "";
        state.showKubeadminPassword = false;
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
            { label: "Console endpoint", value: state.job.state.installAccess.consoleUrl || "Not available" },
            { label: "Kubeconfig", value: state.job.state.installAccess.kubeconfigPath || "Not available" },
            { label: "Username", value: state.job.state.installAccess.kubeadminUsername || "Not available" },
            { label: "Password", value: state.job.state.installAccess.kubeadminPassword || "Not available", password: true }
        ].forEach(function (row) {
            var dt = document.createElement("dt");
            var dd = document.createElement("dd");
            dt.textContent = row.label;
            if (row.password && row.value !== "Not available") {
                dd.appendChild(createPasswordValue(row.value));
            } else {
                dd.textContent = row.value;
            }
            refs.installAccessList.appendChild(dt);
            refs.installAccessList.appendChild(dd);
        });
        refs.installAccessCard.hidden = false;
    } else {
        refs.installAccessCard.hidden = true;
        state.showKubeadminPassword = false;
    }
}

function postInstallContext() {
    var cluster = state.clusters.find(function (entry) {
        return entry.clusterId === draftClusterId();
    });
    var installAccess = state.job && state.job.state ? state.job.state.installAccess : null;
    return {
        cluster: cluster,
        installAccess: installAccess
    };
}

function renderPostInstall() {
    var context = postInstallContext();
    var kubeconfigPath = context.installAccess && context.installAccess.kubeconfigPath
        ? context.installAccess.kubeconfigPath
        : (context.cluster ? context.cluster.kubeconfigPath : "Not available yet");
    var consoleUrl = context.installAccess && context.installAccess.consoleUrl
        ? context.installAccess.consoleUrl
        : (context.cluster ? context.cluster.consoleUrl : "Not available yet");

    refs.discoveryMediaPath.textContent = discoveryMediaPath();
    refs.postInstallPanel.hidden = !(context.installAccess || (context.cluster && context.cluster.health && context.cluster.health.available));
    refs.postInstallKubeconfig.textContent = kubeconfigPath;
    refs.postInstallKubeconfigCommand.textContent = kubeconfigPath === "Not available yet"
        ? "export KUBECONFIG=<kubeconfig-path>"
        : "export KUBECONFIG=" + kubeconfigPath;
    refs.postInstallNodesCommand.textContent = "oc get nodes";
    refs.postInstallConsoleUrl.textContent = consoleUrl;

    if (context.installAccess && context.installAccess.kubeadminPassword) {
        refs.postInstallLoginHint.textContent = "Log in as kubeadmin with the password captured during install.";
    } else if (context.cluster && context.cluster.health && context.cluster.health.available) {
        refs.postInstallLoginHint.textContent = "Use the kubeadmin credentials stored in the generated auth directory.";
    } else {
        refs.postInstallLoginHint.textContent = "Complete the install to retrieve the kubeadmin credentials.";
    }
}

function renderFooter() {
    var onFinalReview = state.currentStep === 7;
    var hasRunningJob = state.job && state.job.running;
    var hasRunningDeployment = hasRunningJob && state.job.state && state.job.state.mode !== "destroy";
    var jobStatus = state.job && state.job.state ? state.job.state.status : "";
    var jobSucceeded = jobStatus === "succeeded";
    var showNext = !onFinalReview;
    var showDeploy = onFinalReview && !hasRunningJob && !jobSucceeded;
    var showRedeploy = onFinalReview && !!state.job;

    refs.backButton.hidden = state.currentStep === 1;
    refs.backButton.disabled = hasRunningJob;
    refs.nextButton.hidden = !showNext;
    refs.deployButton.hidden = !showDeploy;
    refs.redeployButton.hidden = !showRedeploy;
    refs.stopButton.hidden = !hasRunningDeployment;
    refs.nextButton.style.display = showNext ? "" : "none";
    refs.deployButton.style.display = showDeploy ? "" : "none";
    refs.redeployButton.style.display = showRedeploy ? "" : "none";
    refs.stopButton.style.display = hasRunningDeployment ? "" : "none";

    refs.nextButton.textContent = "Next";
    refs.nextButton.disabled = currentStepErrors().length > 0;
    refs.deployButton.disabled = !onFinalReview || overallErrors().length > 0 || hasRunningJob || jobSucceeded;
    refs.redeployButton.disabled = overallErrors().length > 0 || hasRunningJob;
    refs.stopButton.disabled = !hasRunningDeployment;
    refs.cancelButton.textContent = "Cancel";
    refs.cancelButton.disabled = hasRunningJob;
}

function renderYamlPane() {
    refs.wizardWorkspace.classList.toggle("wizard-workspace--yaml", state.yamlMode);
    refs.yamlPane.hidden = !state.yamlMode;
    refs.yamlDivider.hidden = !state.yamlMode;
    refs.wizardWorkspace.style.setProperty("--yaml-pane-width", clampYamlPaneWidth(state.yamlPaneWidth) + "px");
    if (refs.reviewYamlToggle) {
        refs.reviewYamlToggle.checked = state.yamlMode;
    }
}

function renderWizardShell() {
    if (!refs.wizardSection || !refs.wizardClusterSummary) {
        return;
    }
    refs.wizardSection.hidden = !state.wizardOpen;
    refs.wizardClusterSummary.textContent = draftClusterId() || "New draft";
}

function renderLayoutState() {
    renderManagementSummary();
    renderClusterCollections();
    renderWizardShell();
}

function render() {
    syncGeneratedHostYaml();

    refs.clusterName.value = state.clusterName;
    refs.baseDomain.value = state.baseDomain;
    refs.openshiftVersion.value = state.openshiftVersion;
    refs.cpuArchitecture.value = state.cpuArchitecture;
    refs.controlPlaneCount.value = String(state.controlPlaneCount);
    refs.partnerIntegration.value = state.partnerIntegration;
    refs.pullSecretValue.value = state.pullSecretValue;
    refs.pullSecretFile.value = state.pullSecretFile;
    refs.sshPublicKeyValue.value = state.sshPublicKeyValue;
    refs.sshPublicKeyFile.value = state.sshPublicKeyFile;
    refs.primaryInterfaceName.value = state.primaryInterfaceName;
    refs.secondaryInterfaceName.value = state.secondaryInterfaceName;
    refs.privateVlanId.value = state.privateVlanId;
    refs.nodeVcpus.value = String(state.nodeVcpus);
    refs.nodeMemoryMb.value = String(state.nodeMemoryMb);
    refs.diskSizeGb.value = String(state.diskSizeGb);
    refs.performanceDomain.value = state.performanceDomain;
    refs.machineCidr.value = state.machineCidr;
    refs.machineGateway.value = state.machineGateway;
    refs.dnsServers.value = state.dnsServers;
    refs.apiVip.value = state.apiVip;
    refs.ingressVip.value = state.ingressVip;

    renderLayoutState();
    renderStepList();
    renderStep2Layout();
    renderYamlPane();
    renderPanels();
    renderTopology();
    renderOptions();
    renderOperatorSelection();
    renderHostDefinitions();
    renderHostDiscovery();
    renderReview();
    renderArtifacts();
    renderFieldValidation();
    renderValidationAlert();
    renderJob();
    renderPostInstall();
    renderFooter();
}

function clearBackendErrors() {
    state.backendErrors = [];
}

function setJobFromStatus(status) {
    if (!status.running && (!status.state || Object.keys(status.state).length === 0)) {
        state.job = null;
        return;
    }
    if (!status.running && status.state && status.state.mode === "destroy" && status.state.status === "succeeded") {
        state.job = null;
        return;
    }
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
            state.wizardOpen = true;
            state.currentStep = 7;
        } else if (state.job && state.job.state && state.job.state.status === "succeeded" && state.job.state.mode !== "destroy") {
            state.wizardOpen = true;
            state.currentStep = 7;
        }

        if (state.wizardOpen &&
            state.currentStep >= 7 &&
            !state.artifacts.length &&
            status.state &&
            status.state.clusterName &&
            status.state.mode !== "destroy") {
            loadArtifacts("current");
        }

        loadClusters().then(function () {
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
            loadArtifacts("payload");
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
    if (state.currentStep !== 7 || overallErrors().length > 0) {
        return;
    }
    clearBackendErrors();
    render();
    backendCommand("start", ["--payload-b64", encodePayload(payload()), "--mode", mode]).then(function (result) {
        if (!result.ok) {
            state.backendErrors = result.errors || ["Deployment start failed"];
            render();
            return;
        }
        state.wizardOpen = true;
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
        state.wizardOpen = true;
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
    var savedClusters = state.clusters;
    state = createInitialState();
    state.availableStoragePools = savedPools;
    state.availableBridges = savedBridges;
    state.clusters = savedClusters;
    lastArtifactPreviewKey = "";
    state.wizardOpen = pageContext === "create";
    render();
    loadOptions();
}

function openWizard(resetDraft) {
    if (resetDraft) {
        var savedPools = state.availableStoragePools;
        var savedBridges = state.availableBridges;
        var savedClusters = state.clusters;
        state = createInitialState();
        state.availableStoragePools = savedPools;
        state.availableBridges = savedBridges;
        state.clusters = savedClusters;
        if (!state.bridgeName && state.availableBridges.length) {
            state.bridgeName = state.availableBridges[0];
        }
    }
    state.wizardOpen = true;
    state.currentStep = 1;
    render();
    scheduleArtifactPreviewRefresh(true);
}

function closeWizard() {
    if (pageContext === "create") {
        window.location.href = "index.html";
        return;
    }
    state.wizardOpen = false;
    render();
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

function bindText(input, key, parser, afterChange) {
    input.addEventListener("input", function (event) {
        state[key] = parser ? parser(event.target.value) : event.target.value;
        clearBackendErrors();
        if (afterChange) {
            afterChange();
        }
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
    bindText(refs.primaryInterfaceName, "primaryInterfaceName", null, syncGeneratedHostYaml);
    bindText(refs.secondaryInterfaceName, "secondaryInterfaceName", null, syncGeneratedHostYaml);
    bindText(refs.privateVlanId, "privateVlanId", null, syncGeneratedHostYaml);
    bindText(refs.nodeVcpus, "nodeVcpus", function (value) { return parseInt(value, 10) || 0; });
    bindText(refs.nodeMemoryMb, "nodeMemoryMb", function (value) { return parseInt(value, 10) || 0; });
    bindText(refs.diskSizeGb, "diskSizeGb", function (value) { return parseInt(value, 10) || 0; });
    bindText(refs.machineCidr, "machineCidr", null, syncGeneratedHostYaml);
    bindText(refs.machineGateway, "machineGateway", null, syncGeneratedHostYaml);
    bindText(refs.dnsServers, "dnsServers", null, syncGeneratedHostYaml);
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
        syncHostCount();
        syncGeneratedHostYaml();
        clearBackendErrors();
        render();
        scheduleArtifactPreviewRefresh(true);
    });
    refs.partnerIntegration.addEventListener("change", function (event) {
        state.partnerIntegration = event.target.value;
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
    refs.secondaryBridgeName.addEventListener("change", function (event) {
        state.secondaryBridgeName = event.target.value;
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

    refs.networkWideTab.addEventListener("click", function () {
        state.step2Section = "network-wide";
        render();
    });
    refs.hostSpecificTab.addEventListener("click", function () {
        state.step2Section = "host-specific";
        render();
    });
    refs.formViewButton.addEventListener("click", function () {
        state.yamlMode = false;
        render();
    });
    refs.yamlViewButton.addEventListener("click", function () {
        state.yamlMode = true;
        state.step2Section = "host-specific";
        render();
        scheduleArtifactPreviewRefresh(true);
    });
    refs.yamlDivider.addEventListener("pointerdown", startYamlResize);

    if (refs.createClusterButton) {
        refs.createClusterButton.addEventListener("click", function () { openWizard(true); });
    }
    if (refs.backToClustersButton) {
        refs.backToClustersButton.addEventListener("click", closeWizard);
    }
    refs.backButton.addEventListener("click", goBack);
    refs.nextButton.addEventListener("click", goNext);
    refs.deployButton.addEventListener("click", function () { startDeployment("deploy"); });
    refs.redeployButton.addEventListener("click", function () { startDeployment("redeploy"); });
    refs.stopButton.addEventListener("click", cancelDeployment);
    refs.cancelButton.addEventListener("click", resetState);
    refs.reviewYamlToggle.addEventListener("change", function (event) {
        state.yamlMode = event.target.checked;
        render();
        if (state.yamlMode) {
            loadArtifacts("payload");
        }
    });
    refs.artifactCopyButton.addEventListener("click", copyCurrentArtifact);
    refs.artifactDownloadButton.addEventListener("click", downloadCurrentArtifact);
    if (refs.clustersRefreshButton) {
        refs.clustersRefreshButton.addEventListener("click", function () {
            loadClusters();
            refreshStatus();
        });
    }
}

function cacheRefs() {
    refs.summaryDeployedCount = document.getElementById("summary-deployed-count");
    refs.summaryDeployingCount = document.getElementById("summary-deploying-count");
    refs.deployingClustersList = document.getElementById("deploying-clusters-list");
    refs.deployedClustersList = document.getElementById("deployed-clusters-list");
    refs.deployingClustersEmpty = document.getElementById("deploying-clusters-empty");
    refs.deployedClustersEmpty = document.getElementById("deployed-clusters-empty");
    refs.createClusterButton = document.getElementById("create-cluster-button");
    refs.clustersRefreshButton = document.getElementById("clusters-refresh-button");

    refs.wizardSection = document.getElementById("wizard-section");
    refs.backToClustersButton = document.getElementById("back-to-clusters-button");
    refs.wizardClusterSummary = document.getElementById("wizard-cluster-summary");
    refs.wizardWorkspace = document.getElementById("wizard-workspace");
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
    refs.networkWideTab = document.getElementById("network-wide-tab");
    refs.hostSpecificTab = document.getElementById("host-specific-tab");
    refs.formViewButton = document.getElementById("form-view-button");
    refs.yamlViewButton = document.getElementById("yaml-view-button");
    refs.step2NetworkWidePanel = document.getElementById("step-2-network-wide-panel");
    refs.step2HostSpecificPanel = document.getElementById("step-2-host-specific-panel");

    refs.clusterNameField = document.getElementById("cluster-name-field");
    refs.clusterName = document.getElementById("cluster-name");
    refs.clusterNameError = document.getElementById("cluster-name-error");
    refs.baseDomainField = document.getElementById("base-domain-field");
    refs.baseDomain = document.getElementById("base-domain");
    refs.openshiftVersion = document.getElementById("openshift-version");
    refs.cpuArchitectureField = document.getElementById("cpu-architecture-field");
    refs.cpuArchitecture = document.getElementById("cpu-architecture");
    refs.controlPlaneCount = document.getElementById("control-plane-count");
    refs.partnerIntegration = document.getElementById("partner-integration");
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
    refs.secondaryBridgeNameField = document.getElementById("secondary-bridge-name-field");
    refs.secondaryBridgeName = document.getElementById("secondary-bridge-name");
    refs.primaryInterfaceName = document.getElementById("primary-interface-name");
    refs.secondaryInterfaceName = document.getElementById("secondary-interface-name");
    refs.privateVlanId = document.getElementById("private-vlan-id");
    refs.hostDefinitionList = document.getElementById("host-definition-list");
    refs.operatorSelectionList = document.getElementById("operator-selection-list");
    refs.discoveryMediaPath = document.getElementById("discovery-media-path");
    refs.hostDiscoveryList = document.getElementById("host-discovery-list");
    refs.reviewYamlToggleWrap = document.getElementById("review-yaml-toggle-wrap");
    refs.reviewYamlToggle = document.getElementById("review-yaml-toggle");
    refs.addHostsButton = document.getElementById("add-hosts-button");
    refs.storagePoolField = document.getElementById("storage-pool-field");
    refs.storagePool = document.getElementById("storage-pool");
    refs.diskSizeGbField = document.getElementById("disk-size-gb-field");
    refs.diskSizeGb = document.getElementById("disk-size-gb");
    refs.nodeVcpusField = document.getElementById("node-vcpus-field");
    refs.nodeVcpus = document.getElementById("node-vcpus");
    refs.nodeMemoryMbField = document.getElementById("node-memory-mb-field");
    refs.nodeMemoryMb = document.getElementById("node-memory-mb");
    refs.performanceDomain = document.getElementById("performance-domain");
    refs.machineCidrField = document.getElementById("machine-cidr-field");
    refs.machineCidr = document.getElementById("machine-cidr");
    refs.machineGatewayField = document.getElementById("machine-gateway-field");
    refs.machineGateway = document.getElementById("machine-gateway");
    refs.dnsServersField = document.getElementById("dns-servers-field");
    refs.dnsServers = document.getElementById("dns-servers");
    refs.compactVipsSection = document.getElementById("compact-vips-section");
    refs.apiVipField = document.getElementById("api-vip-field");
    refs.apiVip = document.getElementById("api-vip");
    refs.ingressVipField = document.getElementById("ingress-vip-field");
    refs.ingressVip = document.getElementById("ingress-vip");
    refs.snoVipsNote = document.getElementById("sno-vips-note");
    refs.reviewSections = document.getElementById("review-sections");
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
    refs.jobLogPanel = document.getElementById("job-log-panel");
    refs.jobLog = document.getElementById("job-log");
    refs.validationAlert = document.getElementById("validation-alert");
    refs.validationAlertBody = document.getElementById("validation-alert-body");
    refs.postInstallPanel = document.getElementById("post-install-panel");
    refs.postInstallKubeconfig = document.getElementById("post-install-kubeconfig");
    refs.postInstallKubeconfigCommand = document.getElementById("post-install-kubeconfig-command");
    refs.postInstallNodesCommand = document.getElementById("post-install-nodes-command");
    refs.postInstallConsoleUrl = document.getElementById("post-install-console-url");
    refs.postInstallLoginHint = document.getElementById("post-install-login-hint");

    refs.backButton = document.getElementById("back-button");
    refs.nextButton = document.getElementById("next-button");
    refs.deployButton = document.getElementById("deploy-button");
    refs.redeployButton = document.getElementById("redeploy-button");
    refs.stopButton = document.getElementById("stop-button");
    refs.cancelButton = document.getElementById("cancel-button");
}

document.addEventListener("DOMContentLoaded", function () {
    pageContext = document.body.getAttribute("data-page") || "";
    cacheRefs();
    if (pageContext === "create") {
        state.wizardOpen = true;
    }
    bindEvents();
    render();
    loadOptions();
    loadClusters();
    refreshStatus();
});
