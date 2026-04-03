"use strict";

/* global cockpit */

var HELPER_PATH = "/usr/share/cockpit/cockpit-assisted-installer-local/installer_backend.py";

var steps = [
    {
        id: 1,
        label: "Cluster details",
        description: "Choose the local topology and the execution settings for the existing stakkr OpenShift workflow."
    },
    {
        id: 2,
        label: "Operators",
        description: "Review the current local backend scope for optional integrations and operator behavior."
    },
    {
        id: 3,
        label: "Host discovery",
        description: "The local backend uses the repo-managed agent ISO flow and the existing host discovery lifecycle."
    },
    {
        id: 4,
        label: "Storage",
        description: "Review the storage path the local backend will use for the selected topology."
    },
    {
        id: 5,
        label: "Networking",
        description: "Provide the static node and VIP information required by the current stakkr local backend."
    },
    {
        id: 6,
        label: "Custom manifests",
        description: "Custom manifests are not wired yet. This pass uses the repo defaults only."
    },
    {
        id: 7,
        label: "Review and create",
        description: "Review the generated request, validate local prerequisites, and start the deployment."
    }
];

var initialState = {
    currentStep: 1,
    clusterName: "",
    baseDomain: "localhost.com",
    openshiftVersion: "OpenShift 4.21.7",
    cpuArchitecture: "x86_64",
    editPullSecret: false,
    platformIntegration: "No platform integration",
    controlPlaneCount: 3,
    hostsNetworkConfiguration: "dhcp",
    disconnectedEnvironment: false,
    encryptionControlPlane: false,
    encryptionWorkers: false,
    encryptionArbiter: false,
    stakkrRoot: "/home/freemem/redhat/stakkr",
    vaultPasswordFile: "",
    machineCidr: "",
    machineGateway: "",
    dnsServers: "",
    controlPlaneIp1: "",
    controlPlaneIp2: "",
    controlPlaneIp3: "",
    apiVip: "",
    ingressVip: "",
    backendErrors: [],
    job: null
};

var state = cloneState(initialState);
var refs = {};
var pollTimer = null;

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
        .then(function (output) {
            return JSON.parse(output);
        });
}

function dnsServerList() {
    return state.dnsServers
        .split(",")
        .map(function (entry) { return entry.trim(); })
        .filter(function (entry) { return entry.length > 0; });
}

function nodeIpList() {
    var result = [state.controlPlaneIp1.trim()];
    if (state.controlPlaneCount === 3) {
        result.push(state.controlPlaneIp2.trim());
        result.push(state.controlPlaneIp3.trim());
    }
    return result.filter(function (entry) { return entry.length > 0; });
}

function payload() {
    return {
        clusterName: state.clusterName.trim(),
        baseDomain: state.baseDomain.trim(),
        openshiftVersion: state.openshiftVersion,
        cpuArchitecture: state.cpuArchitecture,
        editPullSecret: state.editPullSecret,
        platformIntegration: state.platformIntegration,
        controlPlaneCount: state.controlPlaneCount,
        hostsNetworkConfiguration: state.hostsNetworkConfiguration,
        disconnectedEnvironment: state.disconnectedEnvironment,
        encryptionControlPlane: state.encryptionControlPlane,
        encryptionWorkers: state.encryptionWorkers,
        encryptionArbiter: state.encryptionArbiter,
        stakkrRoot: state.stakkrRoot.trim(),
        vaultPasswordFile: state.vaultPasswordFile.trim(),
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

function reviewRows() {
    var topology = state.controlPlaneCount === 1 ? "Single Node OpenShift (SNO)" : "Compact 3-node";
    var playbook = state.controlPlaneCount === 1 ? "playbooks/site-openshift-sno.yml" : "playbooks/site-openshift-compact.yml";
    var redeployPlaybook = state.controlPlaneCount === 1 ? "playbooks/site-openshift-sno-redeploy.yml" : "playbooks/site-openshift-compact-redeploy.yml";
    var vipSummary = state.controlPlaneCount === 1
        ? state.controlPlaneIp1.trim() || "Not set"
        : (state.apiVip.trim() || "Not set") + " / " + (state.ingressVip.trim() || "Not set");

    return [
        ["Topology", topology],
        ["Cluster", (state.clusterName.trim() || "Not set") + "." + (state.baseDomain.trim() || "Not set")],
        ["OpenShift version", state.openshiftVersion],
        ["stakkr root", state.stakkrRoot.trim() || "Not set"],
        ["Deploy playbook", playbook],
        ["Clean rebuild playbook", redeployPlaybook],
        ["Machine network CIDR", state.machineCidr.trim() || "Not set"],
        ["DNS servers", dnsServerList().join(", ") || "Not set"],
        ["Control plane IPs", nodeIpList().join(", ") || "Not set"],
        ["VIPs", vipSummary]
    ];
}

function currentStepMeta() {
    return steps[state.currentStep - 1];
}

function currentStepErrors() {
    var errors = [];

    if (state.currentStep === 1) {
        if (!state.clusterName.trim()) {
            errors.push("Cluster name");
        }
        if (!state.baseDomain.trim()) {
            errors.push("Base domain");
        }
        if (state.cpuArchitecture !== "x86_64") {
            errors.push("CPU architecture");
        }
        if (state.hostsNetworkConfiguration !== "static") {
            errors.push("Hosts' network configuration");
        }
        if (state.editPullSecret) {
            errors.push("Edit pull secret");
        }
        if (state.platformIntegration !== "No platform integration") {
            errors.push("Integrate with external partner platforms");
        }
        if (state.disconnectedEnvironment) {
            errors.push("Disconnected environment");
        }
        if (state.encryptionControlPlane || state.encryptionWorkers || state.encryptionArbiter) {
            errors.push("Encryption of installation disks");
        }
        if (!state.stakkrRoot.trim()) {
            errors.push("stakkr project root");
        }
        if (!state.vaultPasswordFile.trim()) {
            errors.push("Vault password file");
        }
    }

    if (state.currentStep === 5) {
        if (!state.machineCidr.trim()) {
            errors.push("Machine network CIDR");
        }
        if (!state.machineGateway.trim()) {
            errors.push("Machine gateway");
        }
        if (dnsServerList().length === 0) {
            errors.push("DNS servers");
        }
        if (!state.controlPlaneIp1.trim()) {
            errors.push("Control plane node 1 IP");
        }
        if (state.controlPlaneCount === 3 && !state.controlPlaneIp2.trim()) {
            errors.push("Control plane node 2 IP");
        }
        if (state.controlPlaneCount === 3 && !state.controlPlaneIp3.trim()) {
            errors.push("Control plane node 3 IP");
        }
        if (state.controlPlaneCount === 3 && !state.apiVip.trim()) {
            errors.push("API VIP");
        }
        if (state.controlPlaneCount === 3 && !state.ingressVip.trim()) {
            errors.push("Ingress VIP");
        }
    }

    return errors;
}

function overallErrors() {
    var savedStep = state.currentStep;
    var allErrors = [];
    var seen = {};
    var index;

    for (index = 1; index <= steps.length; index += 1) {
        state.currentStep = index;
        currentStepErrors().forEach(function (error) {
            if (!seen[error]) {
                seen[error] = true;
                allErrors.push(error);
            }
        });
    }

    state.currentStep = savedStep;
    state.backendErrors.forEach(function (error) {
        if (!seen[error]) {
            seen[error] = true;
            allErrors.push(error);
        }
    });

    return allErrors;
}

function stepIsValid(stepNumber) {
    var savedStep = state.currentStep;
    state.currentStep = stepNumber;
    var valid = currentStepErrors().length === 0;
    state.currentStep = savedStep;
    return valid;
}

function clearBackendErrors() {
    state.backendErrors = [];
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
    var stepErrors = currentStepErrors();

    setFieldInvalid(refs.clusterName, refs.clusterNameField, stepErrors.indexOf("Cluster name") >= 0);
    setFieldInvalid(refs.baseDomain, refs.baseDomainField, stepErrors.indexOf("Base domain") >= 0);
    setFieldInvalid(refs.cpuArchitecture, refs.cpuArchitectureField, stepErrors.indexOf("CPU architecture") >= 0);
    setFieldInvalid(refs.stakkrRoot, refs.stakkrRootField, stepErrors.indexOf("stakkr project root") >= 0);
    setFieldInvalid(refs.vaultPasswordFile, refs.vaultPasswordFileField, stepErrors.indexOf("Vault password file") >= 0);
    setFieldInvalid(null, refs.hostsNetworkField, stepErrors.indexOf("Hosts' network configuration") >= 0);
    setFieldInvalid(null, refs.editPullSecretField, stepErrors.indexOf("Edit pull secret") >= 0);
    setFieldInvalid(null, refs.platformIntegrationField, stepErrors.indexOf("Integrate with external partner platforms") >= 0);
    setFieldInvalid(null, refs.diskEncryptionField, stepErrors.indexOf("Encryption of installation disks") >= 0);

    setFieldInvalid(refs.machineCidr, refs.machineCidrField, stepErrors.indexOf("Machine network CIDR") >= 0);
    setFieldInvalid(refs.machineGateway, refs.machineGatewayField, stepErrors.indexOf("Machine gateway") >= 0);
    setFieldInvalid(refs.dnsServers, refs.dnsServersField, stepErrors.indexOf("DNS servers") >= 0);
    setFieldInvalid(refs.controlPlaneIp1, refs.controlPlaneIp1Field, stepErrors.indexOf("Control plane node 1 IP") >= 0);
    setFieldInvalid(refs.controlPlaneIp2, refs.controlPlaneIp2Field, stepErrors.indexOf("Control plane node 2 IP") >= 0);
    setFieldInvalid(refs.controlPlaneIp3, refs.controlPlaneIp3Field, stepErrors.indexOf("Control plane node 3 IP") >= 0);
    setFieldInvalid(refs.apiVip, refs.apiVipField, stepErrors.indexOf("API VIP") >= 0);
    setFieldInvalid(refs.ingressVip, refs.ingressVipField, stepErrors.indexOf("Ingress VIP") >= 0);

    refs.clusterNameError.hidden = stepErrors.indexOf("Cluster name") < 0;
}

function renderValidationAlert() {
    var errors = currentStepErrors();
    var showGlobalAlert = errors.length > 0 && state.currentStep !== 7;

    refs.validationAlert.hidden = !showGlobalAlert;
    refs.validationAlertBody.textContent = showGlobalAlert
        ? "The following fields are invalid or missing: " + errors.join(", ") + "."
        : "";

    refs.preflightAlert.hidden = true;
    refs.preflightAlertBody.textContent = "";

    if (state.currentStep === 7) {
        errors = overallErrors();
    }

    if (state.currentStep === 7 && errors.length > 0) {
        refs.preflightAlert.hidden = false;
        refs.preflightAlertBody.textContent = "The following fields are invalid or missing: " + errors.join(", ") + ".";
    }
}

function renderStepList() {
    var list = refs.stepList;
    list.innerHTML = "";

    steps.forEach(function (step) {
        var item = document.createElement("li");
        var classes = ["wizard-step"];
        if (step.id === state.currentStep) {
            classes.push("wizard-step--active");
        } else if (step.id < state.currentStep) {
            classes.push("wizard-step--complete");
        } else {
            classes.push("wizard-step--disabled");
        }
        item.className = classes.join(" ");
        item.setAttribute("aria-current", step.id === state.currentStep ? "step" : "false");

        if (step.id < state.currentStep) {
            item.classList.add("wizard-step--clickable");
            item.addEventListener("click", function () {
                state.currentStep = step.id;
                clearBackendErrors();
                render();
            });
        }

        var number = document.createElement("span");
        number.className = "wizard-step__number";
        number.textContent = String(step.id);

        var text = document.createElement("span");
        text.className = "wizard-step__label";
        text.textContent = step.label;

        item.appendChild(number);
        item.appendChild(text);
        list.appendChild(item);
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

function renderFooter() {
    var onReview = state.currentStep === 7;
    var hasJob = state.job && state.job.running;

    refs.backButton.hidden = state.currentStep === 1;
    refs.nextButton.hidden = onReview;
    refs.deployButton.hidden = !onReview;
    refs.redeployButton.hidden = !onReview;
    refs.stopButton.hidden = !hasJob;

    refs.nextButton.disabled = currentStepErrors().length > 0;
    refs.deployButton.disabled = overallErrors().length > 0 || hasJob;
    refs.redeployButton.disabled = overallErrors().length > 0 || hasJob;
    refs.cancelButton.textContent = hasJob ? "Reset view" : "Cancel";
}

function renderJob() {
    var job = state.job;

    if (!job) {
        refs.jobStatusSummary.textContent = "No deployment has been started yet.";
        refs.jobCurrentTask.textContent = "";
        refs.jobLog.textContent = "No log output yet.";
        return;
    }

    var statusText = "Last known status: " + (job.state.status || "unknown");
    if (job.state.openshiftRelease) {
        statusText += " on OpenShift " + job.state.openshiftRelease;
    }
    if (job.state.clusterName && job.state.baseDomain) {
        statusText += " for " + job.state.clusterName + "." + job.state.baseDomain;
    }

    refs.jobStatusSummary.textContent = statusText;
    refs.jobCurrentTask.textContent = job.currentTask || "";
    refs.jobLog.textContent = (job.logTail && job.logTail.length)
        ? job.logTail.join("\n")
        : "No log output yet.";
}

function render() {
    refs.clusterName.value = state.clusterName;
    refs.baseDomain.value = state.baseDomain;
    refs.openshiftVersion.value = state.openshiftVersion;
    refs.cpuArchitecture.value = state.cpuArchitecture;
    refs.editPullSecret.checked = state.editPullSecret;
    refs.platformIntegration.value = state.platformIntegration;
    refs.controlPlaneCount.value = String(state.controlPlaneCount);
    refs.networkDhcp.checked = state.hostsNetworkConfiguration === "dhcp";
    refs.networkStatic.checked = state.hostsNetworkConfiguration === "static";
    refs.disconnectedToggle.checked = state.disconnectedEnvironment;
    refs.encryptControlPlane.checked = state.encryptionControlPlane;
    refs.encryptWorkers.checked = state.encryptionWorkers;
    refs.encryptArbiter.checked = state.encryptionArbiter;
    refs.stakkrRoot.value = state.stakkrRoot;
    refs.vaultPasswordFile.value = state.vaultPasswordFile;
    refs.machineCidr.value = state.machineCidr;
    refs.machineGateway.value = state.machineGateway;
    refs.dnsServers.value = state.dnsServers;
    refs.controlPlaneIp1.value = state.controlPlaneIp1;
    refs.controlPlaneIp2.value = state.controlPlaneIp2;
    refs.controlPlaneIp3.value = state.controlPlaneIp3;
    refs.apiVip.value = state.apiVip;
    refs.ingressVip.value = state.ingressVip;

    renderStepList();
    renderPanels();
    renderTopology();
    renderReview();
    renderFieldValidation();
    renderValidationAlert();
    renderFooter();
    renderJob();
}

function setJobFromStatus(status) {
    state.job = {
        running: status.running,
        state: status.state || {},
        service: status.service || {},
        logTail: status.logTail || [],
        currentTask: status.currentTask || ""
    };
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
        render();
        schedulePoll();
    }).catch(function (error) {
        state.backendErrors = [String(error)];
        render();
    });
}

function runPreflight() {
    return backendCommand("preflight", ["--payload-b64", encodePayload(payload())])
        .then(function (result) {
            state.backendErrors = result.ok ? [] : (result.errors || []);
            render();
            return result;
        })
        .catch(function (error) {
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
            refreshStatus();
        }
    }
}

function goBack() {
    clearBackendErrors();
    if (state.currentStep > 1) {
        state.currentStep -= 1;
        render();
    }
}

function startDeployment(mode) {
    clearBackendErrors();
    render();

    backendCommand("start", ["--payload-b64", encodePayload(payload()), "--mode", mode])
        .then(function (result) {
            if (!result.ok) {
                state.backendErrors = result.errors || ["Deployment start failed"];
                render();
                return;
            }

            state.currentStep = 7;
            refreshStatus();
        })
        .catch(function (error) {
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

function resetState() {
    stopPolling();
    state = cloneState(initialState);
    refreshStatus();
    render();
}

function bindInput(input, key, parser) {
    input.addEventListener("input", function (event) {
        state[key] = parser ? parser(event.target.value) : event.target.value;
        clearBackendErrors();
        render();
    });
}

function bindEvents() {
    bindInput(refs.clusterName, "clusterName");
    bindInput(refs.baseDomain, "baseDomain");
    bindInput(refs.stakkrRoot, "stakkrRoot");
    bindInput(refs.vaultPasswordFile, "vaultPasswordFile");
    bindInput(refs.machineCidr, "machineCidr");
    bindInput(refs.machineGateway, "machineGateway");
    bindInput(refs.dnsServers, "dnsServers");
    bindInput(refs.controlPlaneIp1, "controlPlaneIp1");
    bindInput(refs.controlPlaneIp2, "controlPlaneIp2");
    bindInput(refs.controlPlaneIp3, "controlPlaneIp3");
    bindInput(refs.apiVip, "apiVip");
    bindInput(refs.ingressVip, "ingressVip");

    refs.openshiftVersion.addEventListener("change", function (event) {
        state.openshiftVersion = event.target.value;
        clearBackendErrors();
        render();
    });

    refs.cpuArchitecture.addEventListener("change", function (event) {
        state.cpuArchitecture = event.target.value;
        clearBackendErrors();
        render();
    });

    refs.editPullSecret.addEventListener("change", function (event) {
        state.editPullSecret = event.target.checked;
        clearBackendErrors();
        render();
    });

    refs.platformIntegration.addEventListener("change", function (event) {
        state.platformIntegration = event.target.value;
        clearBackendErrors();
        render();
    });

    refs.controlPlaneCount.addEventListener("change", function (event) {
        state.controlPlaneCount = parseInt(event.target.value, 10);
        clearBackendErrors();
        render();
    });

    refs.networkDhcp.addEventListener("change", function (event) {
        if (event.target.checked) {
            state.hostsNetworkConfiguration = "dhcp";
            clearBackendErrors();
            render();
        }
    });

    refs.networkStatic.addEventListener("change", function (event) {
        if (event.target.checked) {
            state.hostsNetworkConfiguration = "static";
            clearBackendErrors();
            render();
        }
    });

    refs.disconnectedToggle.addEventListener("change", function (event) {
        state.disconnectedEnvironment = event.target.checked;
        clearBackendErrors();
        render();
    });

    refs.encryptControlPlane.addEventListener("change", function (event) {
        state.encryptionControlPlane = event.target.checked;
        clearBackendErrors();
        render();
    });

    refs.encryptWorkers.addEventListener("change", function (event) {
        state.encryptionWorkers = event.target.checked;
        clearBackendErrors();
        render();
    });

    refs.encryptArbiter.addEventListener("change", function (event) {
        state.encryptionArbiter = event.target.checked;
        clearBackendErrors();
        render();
    });

    refs.backButton.addEventListener("click", goBack);
    refs.nextButton.addEventListener("click", goNext);
    refs.deployButton.addEventListener("click", function () { startDeployment("deploy"); });
    refs.redeployButton.addEventListener("click", function () { startDeployment("redeploy"); });
    refs.stopButton.addEventListener("click", cancelDeployment);
    refs.cancelButton.addEventListener("click", resetState);
}

function cacheRefs() {
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
    refs.editPullSecretField = document.getElementById("edit-pull-secret-field");
    refs.editPullSecret = document.getElementById("edit-pull-secret");
    refs.platformIntegrationField = document.getElementById("platform-integration-field");
    refs.platformIntegration = document.getElementById("platform-integration");
    refs.controlPlaneCount = document.getElementById("control-plane-count");
    refs.hostsNetworkField = document.getElementById("hosts-network-field");
    refs.networkDhcp = document.getElementById("network-dhcp");
    refs.networkStatic = document.getElementById("network-static");
    refs.disconnectedToggle = document.getElementById("disconnected-toggle");
    refs.diskEncryptionField = document.getElementById("disk-encryption-field");
    refs.encryptControlPlane = document.getElementById("encrypt-control-plane");
    refs.encryptWorkers = document.getElementById("encrypt-workers");
    refs.encryptArbiter = document.getElementById("encrypt-arbiter");
    refs.stakkrRootField = document.getElementById("stakkr-root-field");
    refs.stakkrRoot = document.getElementById("stakkr-root");
    refs.vaultPasswordFileField = document.getElementById("vault-password-file-field");
    refs.vaultPasswordFile = document.getElementById("vault-password-file");
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
    refs.preflightAlert = document.getElementById("preflight-alert");
    refs.preflightAlertBody = document.getElementById("preflight-alert-body");
    refs.jobStatusSummary = document.getElementById("job-status-summary");
    refs.jobCurrentTask = document.getElementById("job-current-task");
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
    refreshStatus();
});
