"use strict";

var steps = [
    "Cluster details",
    "Operators",
    "Host discovery",
    "Storage",
    "Networking",
    "Custom manifests",
    "Review and create"
];

var initialState = {
    clusterName: "",
    baseDomain: "localhost.com",
    openshiftVersion: "OpenShift 4.21.7",
    cpuArchitecture: "x86_64",
    editPullSecret: false,
    platformIntegration: "No platform integration",
    controlPlaneNodes: "3 (highly available cluster)",
    hostsNetworkConfiguration: "dhcp",
    disconnectedEnvironment: false,
    encryptionControlPlane: false,
    encryptionWorkers: false,
    encryptionArbiter: false
};

var state = Object.assign({}, initialState);
var refs = {};

function isClusterNameValid() {
    return state.clusterName.trim().length > 0;
}

function renderStepList() {
    var list = refs.stepList;
    list.innerHTML = "";

    steps.forEach(function (label, index) {
        var item = document.createElement("li");
        item.className = "wizard-step " + (index === 0 ? "wizard-step--active" : "wizard-step--disabled");
        item.setAttribute("aria-current", index === 0 ? "step" : "false");

        var number = document.createElement("span");
        number.className = "wizard-step__number";
        number.textContent = String(index + 1);

        var text = document.createElement("span");
        text.className = "wizard-step__label";
        text.textContent = label;

        item.appendChild(number);
        item.appendChild(text);
        list.appendChild(item);
    });
}

function renderValidation() {
    var valid = isClusterNameValid();

    refs.clusterName.classList.toggle("is-invalid", !valid);
    refs.clusterNameField.classList.toggle("is-invalid", !valid);
    refs.clusterNameError.hidden = valid;
    refs.validationAlert.hidden = valid;
    refs.nextButton.disabled = !valid;
    refs.clusterName.setAttribute("aria-invalid", valid ? "false" : "true");
}

function renderState() {
    refs.clusterName.value = state.clusterName;
    refs.baseDomain.value = state.baseDomain;
    refs.openshiftVersion.value = state.openshiftVersion;
    refs.cpuArchitecture.value = state.cpuArchitecture;
    refs.editPullSecret.checked = state.editPullSecret;
    refs.platformIntegration.value = state.platformIntegration;
    refs.controlPlaneNodes.value = state.controlPlaneNodes;
    refs.networkDhcp.checked = state.hostsNetworkConfiguration === "dhcp";
    refs.networkStatic.checked = state.hostsNetworkConfiguration === "static";
    refs.disconnectedToggle.checked = state.disconnectedEnvironment;
    refs.encryptControlPlane.checked = state.encryptionControlPlane;
    refs.encryptWorkers.checked = state.encryptionWorkers;
    refs.encryptArbiter.checked = state.encryptionArbiter;

    renderValidation();
    refs.nextStatus.hidden = true;
}

function resetState() {
    state = Object.assign({}, initialState);
    renderState();
}

function bindEvents() {
    refs.clusterName.addEventListener("input", function (event) {
        state.clusterName = event.target.value;
        renderValidation();
    });

    refs.baseDomain.addEventListener("input", function (event) {
        state.baseDomain = event.target.value;
    });

    refs.openshiftVersion.addEventListener("change", function (event) {
        state.openshiftVersion = event.target.value;
    });

    refs.cpuArchitecture.addEventListener("change", function (event) {
        state.cpuArchitecture = event.target.value;
    });

    refs.editPullSecret.addEventListener("change", function (event) {
        state.editPullSecret = event.target.checked;
    });

    refs.platformIntegration.addEventListener("change", function (event) {
        state.platformIntegration = event.target.value;
    });

    refs.controlPlaneNodes.addEventListener("change", function (event) {
        state.controlPlaneNodes = event.target.value;
    });

    refs.networkDhcp.addEventListener("change", function (event) {
        if (event.target.checked) {
            state.hostsNetworkConfiguration = "dhcp";
        }
    });

    refs.networkStatic.addEventListener("change", function (event) {
        if (event.target.checked) {
            state.hostsNetworkConfiguration = "static";
        }
    });

    refs.disconnectedToggle.addEventListener("change", function (event) {
        state.disconnectedEnvironment = event.target.checked;
    });

    refs.encryptControlPlane.addEventListener("change", function (event) {
        state.encryptionControlPlane = event.target.checked;
    });

    refs.encryptWorkers.addEventListener("change", function (event) {
        state.encryptionWorkers = event.target.checked;
    });

    refs.encryptArbiter.addEventListener("change", function (event) {
        state.encryptionArbiter = event.target.checked;
    });

    refs.cancelButton.addEventListener("click", function () {
        resetState();
    });

    refs.nextButton.addEventListener("click", function () {
        if (!isClusterNameValid()) {
            renderValidation();
            refs.clusterName.focus();
            return;
        }

        refs.nextStatus.hidden = false;
    });
}

function cacheRefs() {
    refs.stepList = document.getElementById("step-list");
    refs.clusterNameField = document.getElementById("cluster-name-field");
    refs.clusterName = document.getElementById("cluster-name");
    refs.clusterNameError = document.getElementById("cluster-name-error");
    refs.baseDomain = document.getElementById("base-domain");
    refs.openshiftVersion = document.getElementById("openshift-version");
    refs.cpuArchitecture = document.getElementById("cpu-architecture");
    refs.editPullSecret = document.getElementById("edit-pull-secret");
    refs.platformIntegration = document.getElementById("platform-integration");
    refs.controlPlaneNodes = document.getElementById("control-plane-count");
    refs.networkDhcp = document.getElementById("network-dhcp");
    refs.networkStatic = document.getElementById("network-static");
    refs.disconnectedToggle = document.getElementById("disconnected-toggle");
    refs.encryptControlPlane = document.getElementById("encrypt-control-plane");
    refs.encryptWorkers = document.getElementById("encrypt-workers");
    refs.encryptArbiter = document.getElementById("encrypt-arbiter");
    refs.validationAlert = document.getElementById("validation-alert");
    refs.nextStatus = document.getElementById("next-status");
    refs.nextButton = document.getElementById("next-button");
    refs.cancelButton = document.getElementById("cancel-button");
}

document.addEventListener("DOMContentLoaded", function () {
    cacheRefs();
    renderStepList();
    renderState();
    bindEvents();
});
