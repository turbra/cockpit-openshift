#!/usr/bin/env python3
"""
Cockpit backend for driving the local stakkr OpenShift workflow.

This helper runs on the KVM host via cockpit.spawn(superuser="require").
It validates a request payload, writes the local-only stakkr OpenShift input
files, launches the correct site playbook in a transient systemd unit, and
reports job status back to the UI.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import ipaddress
import json
import os
import re
import subprocess
import sys
from pathlib import Path


STATE_DIR = Path("/var/lib/cockpit-assisted-installer-local")
STATE_FILE = STATE_DIR / "state.json"
LOG_FILE = STATE_DIR / "install.log"
REQUEST_FILE = STATE_DIR / "request.json"
RUNTIME_HOME_DIR = STATE_DIR / "home"
RUNTIME_CACHE_DIR = STATE_DIR / "cache"
DEFAULT_STAKKR_ROOT = "/home/freemem/redhat/stakkr"
HELPER_PATH = Path("/usr/share/cockpit/cockpit-assisted-installer-local/installer_backend.py")
SUPPORTED_ARCH = "x86_64"
DEFAULT_PLATFORM_INTEGRATION = "No platform integration"
DEFAULT_VERSION = "OpenShift 4.21.7"
VERSION_PATTERN = re.compile(r"^OpenShift (?P<version>\d+\.\d+\.\d+)$")
CLUSTER_NAME_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def save_state(data: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")


def ensure_runtime_dirs() -> None:
    for path in [STATE_DIR, RUNTIME_HOME_DIR, RUNTIME_CACHE_DIR]:
        path.mkdir(parents=True, exist_ok=True)


def run(*argv: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(list(argv), check=check, capture_output=True, text=True)


def json_response(payload: dict, exit_code: int = 0) -> int:
    print(json.dumps(payload, indent=2, sort_keys=True))
    return exit_code


def parse_payload(payload_b64: str) -> dict:
    try:
        raw = base64.b64decode(payload_b64.encode("utf-8"))
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Invalid payload: {exc}") from exc


def current_timestamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def normalize_topology(payload: dict) -> str:
    count = int(payload.get("controlPlaneCount", 0))
    if count == 1:
        return "sno"
    if count == 3:
        return "compact"
    raise ValueError("controlPlaneCount must be 1 or 3")


def validate_cluster_name(value: str, errors: list[str]) -> None:
    if not value:
        errors.append("Cluster name")
        return
    if not CLUSTER_NAME_PATTERN.match(value):
        errors.append("Cluster name must contain only lowercase letters, numbers, and hyphens")


def validate_ip(value: str, field_name: str, errors: list[str]) -> None:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        errors.append(field_name)


def validate_payload(payload: dict) -> tuple[dict, list[str]]:
    errors: list[str] = []

    cluster_name = str(payload.get("clusterName", "")).strip()
    base_domain = str(payload.get("baseDomain", "")).strip()
    stakkr_root = str(payload.get("stakkrRoot", DEFAULT_STAKKR_ROOT)).strip()
    vault_password_file = str(payload.get("vaultPasswordFile", "")).strip()
    cpu_architecture = str(payload.get("cpuArchitecture", "")).strip()
    hosts_network = str(payload.get("hostsNetworkConfiguration", "")).strip()
    platform_integration = str(payload.get("platformIntegration", "")).strip()
    topology = normalize_topology(payload)
    version_label = str(payload.get("openshiftVersion", DEFAULT_VERSION)).strip()
    match = VERSION_PATTERN.match(version_label)

    validate_cluster_name(cluster_name, errors)

    if not base_domain:
        errors.append("Base domain")

    if not vault_password_file:
        errors.append("Vault password file")

    if cpu_architecture != SUPPORTED_ARCH:
        errors.append("CPU architecture must remain x86_64 for the current local backend")

    if hosts_network != "static":
        errors.append("Hosts' network configuration must be Static IP, bridges, and bonds")

    if payload.get("disconnectedEnvironment"):
        errors.append("Disconnected installs are not wired yet")

    if payload.get("editPullSecret"):
        errors.append("Pull secret editing is not wired yet")

    if payload.get("encryptionControlPlane") or payload.get("encryptionWorkers") or payload.get("encryptionArbiter"):
        errors.append("Disk encryption toggles are not wired yet")

    if platform_integration != DEFAULT_PLATFORM_INTEGRATION:
        errors.append("External partner platform integration is not wired yet")

    if not match:
        errors.append("OpenShift version")

    network = payload.get("network", {}) or {}
    machine_cidr = str(network.get("machineCidr", "")).strip()
    machine_gateway = str(network.get("machineGateway", "")).strip()
    dns_servers = [str(entry).strip() for entry in network.get("dnsServers", []) if str(entry).strip()]
    node_ips = [str(entry).strip() for entry in network.get("nodeIps", []) if str(entry).strip()]

    if not machine_cidr:
        errors.append("Machine network CIDR")
    else:
        try:
            ipaddress.ip_network(machine_cidr, strict=False)
        except ValueError:
            errors.append("Machine network CIDR")

    if not machine_gateway:
        errors.append("Machine gateway")
    else:
        validate_ip(machine_gateway, "Machine gateway", errors)

    if not dns_servers:
        errors.append("DNS servers")
    else:
        for idx, server in enumerate(dns_servers, start=1):
            validate_ip(server, f"DNS server {idx}", errors)

    required_node_count = 1 if topology == "sno" else 3
    if len(node_ips) != required_node_count:
        errors.append(f"Exactly {required_node_count} control plane node IPs are required")
    else:
        for idx, node_ip in enumerate(node_ips, start=1):
            validate_ip(node_ip, f"Control plane node {idx} IP", errors)

    api_vip = ""
    ingress_vip = ""
    if topology == "compact":
        api_vip = str(network.get("apiVip", "")).strip()
        ingress_vip = str(network.get("ingressVip", "")).strip()
        if not api_vip:
            errors.append("API VIP")
        else:
            validate_ip(api_vip, "API VIP", errors)
        if not ingress_vip:
            errors.append("Ingress VIP")
        else:
            validate_ip(ingress_vip, "Ingress VIP", errors)
        if api_vip and ingress_vip and api_vip == ingress_vip:
            errors.append("API VIP and ingress VIP must differ for compact clusters")
        if api_vip and api_vip in node_ips:
            errors.append("API VIP must not match a control plane node IP")
        if ingress_vip and ingress_vip in node_ips:
            errors.append("Ingress VIP must not match a control plane node IP")
    else:
        api_vip = node_ips[0] if node_ips else ""
        ingress_vip = node_ips[0] if node_ips else ""

    stakkr_path = Path(stakkr_root)
    inventory_path = stakkr_path / "inventory" / "hosts.yml"
    secret_root = stakkr_path / "secrets"
    pull_secret_file = secret_root / "pull-secret.txt"
    ssh_public_key_file = secret_root / "id_ed25519.pub"

    if not stakkr_path.exists():
        errors.append("stakkr project root")
    if not inventory_path.exists():
        errors.append("stakkr inventory/hosts.yml")
    if not Path(vault_password_file).exists():
        errors.append("Vault password file")
    if not pull_secret_file.exists():
        errors.append("stakkr secrets/pull-secret.txt")
    if not ssh_public_key_file.exists():
        errors.append("stakkr secrets/id_ed25519.pub")

    try:
        run("ansible-playbook", "--version", check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        errors.append("ansible-playbook")

    try:
        run("systemd-run", "--version", check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        errors.append("systemd-run")

    normalized = {
        "clusterName": cluster_name,
        "baseDomain": base_domain,
        "stakkrRoot": stakkr_root,
        "vaultPasswordFile": vault_password_file,
        "cpuArchitecture": cpu_architecture,
        "hostsNetworkConfiguration": hosts_network,
        "openshiftVersion": version_label,
        "openshiftRelease": match.group("version") if match else "",
        "topology": topology,
        "platformType": "none" if topology == "sno" else "baremetal",
        "platformIntegration": platform_integration,
        "network": {
            "machineCidr": machine_cidr,
            "machineGateway": machine_gateway,
            "dnsServers": dns_servers,
            "nodeIps": node_ips,
            "apiVip": api_vip,
            "ingressVip": ingress_vip,
        },
    }

    return normalized, errors


def control_plane_nodes(topology: str, node_ips: list[str], prefix_length: int) -> list[dict]:
    if topology == "sno":
        return [
            {
                "name": "ocp-control-01",
                "role": "control-plane",
                "mac_address": "52:54:00:40:00:10",
                "machine_ip": node_ips[0],
                "prefix_length": prefix_length,
            }
        ]

    return [
        {
            "name": "ocp-master-01",
            "role": "control-plane",
            "mac_address": "52:54:00:40:00:10",
            "machine_ip": node_ips[0],
            "prefix_length": prefix_length,
        },
        {
            "name": "ocp-master-02",
            "role": "control-plane",
            "mac_address": "52:54:00:40:00:11",
            "machine_ip": node_ips[1],
            "prefix_length": prefix_length,
        },
        {
            "name": "ocp-master-03",
            "role": "control-plane",
            "mac_address": "52:54:00:40:00:12",
            "machine_ip": node_ips[2],
            "prefix_length": prefix_length,
        },
    ]


def render_install_cluster_yaml(request: dict) -> str:
    prefix_length = ipaddress.ip_network(request["network"]["machineCidr"], strict=False).prefixlen
    lines = [
        "---",
        "openshift_install_cluster:",
        f"  name: {request['clusterName']}",
        f"  base_domain: {request['baseDomain']}",
        f"  platform_type: {request['platformType']}",
        "  network:",
        f"    machine_cidr: {request['network']['machineCidr']}",
        f"    machine_gateway: {request['network']['machineGateway']}",
        "    machine_dns_servers:",
    ]

    for server in request["network"]["dnsServers"]:
        lines.append(f"      - {server}")

    lines.extend(
        [
            f"    api_vip: {request['network']['apiVip']}",
            f"    ingress_vip: {request['network']['ingressVip']}",
            "  nodes:",
        ]
    )

    for node in control_plane_nodes(request["topology"], request["network"]["nodeIps"], prefix_length):
        lines.extend(
            [
                f"    - name: {node['name']}",
                f"      role: {node['role']}",
                f"      mac_address: \"{node['mac_address']}\"",
                "      machine_network:",
                f"        ipv4_address: {node['machine_ip']}",
                f"        prefix_length: {node['prefix_length']}",
            ]
        )

    return "\n".join(lines) + "\n"


def render_vm_yaml(request: dict) -> str:
    defaults = [
        "---",
        "openshift_cluster_vm_defaults:",
        "  domain: \"{{ openshift_install_cluster.name }}.{{ openshift_install_cluster.base_domain }}\"",
        "  osinfo: rhel10.1",
        "  boot:",
        "    firmware: uefi",
        "    machine: q35",
        "    cpu_model: host-passthrough",
        "    tpm_enabled: false",
        "  network:",
        "    attachment_type: bridge",
        "    bridge_name: bridge0",
        "    libvirt_network: \"\"",
        "    libvirt_portgroup: \"\"",
        "    model: virtio",
        "  provisioning:",
        "    recreate_domain: false",
        "    reinitialize_root_disk: false",
        "  performance_domain:",
        "    tier: gold",
        "    iothreads: 0",
        "  access:",
        "    attach_agent_boot_media: true",
        "    agent_boot_media_path: /var/lib/libvirt/images/agent.x86_64.iso",
        "    agent_boot_media_target_dev: sdb",
        "  console:",
        "    graphics_type: none",
        "    vnc_listen: 127.0.0.1",
        "  disks:",
        "    root:",
        f"      format: {'qcow2' if request['topology'] == 'sno' else 'raw'}",
        "      size_gb: 120",
        "      bus: scsi",
        "      cache: none",
        "      io: native",
        "      discard: unmap",
        "      rotation_rate: 1",
        "      serial: \"\"",
        "",
        "openshift_cluster_nodes:",
    ]

    if request["topology"] == "sno":
        nodes = [
            {
                "name": "ocp-control-01",
                "mac_address": "52:54:00:40:00:10",
                "vcpus": 12,
                "memory_mb": 32768,
                "disk_path": "/var/lib/libvirt/images/ocp-control-01.qcow2",
                "serial": "ocpcontrol01root",
            }
        ]
    else:
        nodes = [
            {
                "name": "ocp-master-01",
                "mac_address": "52:54:00:40:00:10",
                "vcpus": 10,
                "memory_mb": 16384,
                "disk_path": "/dev/ocptb/ocp-master-01",
                "serial": "ocpmaster01root",
            },
            {
                "name": "ocp-master-02",
                "mac_address": "52:54:00:40:00:11",
                "vcpus": 10,
                "memory_mb": 16384,
                "disk_path": "/dev/ocptb/ocp-master-02",
                "serial": "ocpmaster02root",
            },
            {
                "name": "ocp-master-03",
                "mac_address": "52:54:00:40:00:12",
                "vcpus": 10,
                "memory_mb": 16384,
                "disk_path": "/dev/ocptb/ocp-master-03",
                "serial": "ocpmaster03root",
            },
        ]

    lines = list(defaults)
    for node in nodes:
        lines.extend(
            [
                f"  - name: {node['name']}",
                "    role: control-plane",
                f"    mac_address: \"{node['mac_address']}\"",
                "    resources:",
                f"      vcpus: {node['vcpus']}",
                f"      memory_mb: {node['memory_mb']}",
                "    performance_domain:",
                "      tier: gold",
                "      iothreads: 0",
                "    disks:",
                "      root:",
                f"        path: {node['disk_path']}",
                f"        serial: {node['serial']}",
                "",
            ]
        )

    return "\n".join(lines).rstrip() + "\n"


def write_stakkr_inputs(request: dict) -> None:
    stakkr_root = Path(request["stakkrRoot"])
    install_cluster_path = stakkr_root / "vars" / "cluster" / "openshift_install_cluster.yml"
    cluster_vm_path = stakkr_root / "vars" / "guests" / "openshift_cluster_vm.yml"

    install_cluster_path.write_text(render_install_cluster_yaml(request), encoding="utf-8")
    cluster_vm_path.write_text(render_vm_yaml(request), encoding="utf-8")


def build_ansible_command(request: dict, mode: str) -> list[str]:
    playbook_name = {
        ("sno", "deploy"): "playbooks/site-openshift-sno.yml",
        ("sno", "redeploy"): "playbooks/site-openshift-sno-redeploy.yml",
        ("compact", "deploy"): "playbooks/site-openshift-compact.yml",
        ("compact", "redeploy"): "playbooks/site-openshift-compact-redeploy.yml",
    }[(request["topology"], mode)]

    cmd = [
        "ansible-playbook",
        "-i",
        "inventory/hosts.yml",
        playbook_name,
        "--vault-password-file",
        request["vaultPasswordFile"],
        "-e",
        f"openshift_installer_release={request['openshiftRelease']}",
    ]

    if mode == "redeploy":
        cmd.extend(["-e", "openshift_cluster_cleanup_remove_disk_files=true"])

    return cmd


def tail_log(lines: int = 120) -> list[str]:
    if not LOG_FILE.exists():
        return []
    content = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
    return content[-lines:]


def current_task_from_log(log_lines: list[str]) -> str:
    for line in reversed(log_lines):
        if line.startswith("TASK ["):
            return line.strip()
        if line.startswith("PLAY ["):
            return line.strip()
    return ""


def unit_status(unit_name: str) -> dict:
    if not unit_name:
        return {}
    proc = run(
        "systemctl",
        "show",
        unit_name,
        "--property=ActiveState,SubState,Result,ExecMainStatus,LoadState",
        check=False,
    )
    status: dict[str, str | int] = {}
    for line in proc.stdout.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        status[key] = value
    return status


def job_running(state: dict) -> bool:
    unit_name = state.get("unitName", "")
    if not unit_name:
        return False
    status = unit_status(unit_name)
    return status.get("ActiveState") in {"active", "activating"}


def record_request_summary(request: dict, mode: str, unit_name: str) -> dict:
    return {
        "clusterName": request["clusterName"],
        "baseDomain": request["baseDomain"],
        "topology": request["topology"],
        "platformType": request["platformType"],
        "openshiftRelease": request["openshiftRelease"],
        "stakkrRoot": request["stakkrRoot"],
        "mode": mode,
        "unitName": unit_name,
        "startedAt": current_timestamp(),
        "requestedNetwork": request["network"],
    }


def handle_preflight(payload_b64: str) -> int:
    try:
        request, errors = validate_payload(parse_payload(payload_b64))
    except ValueError as exc:
        return json_response({"ok": False, "errors": [str(exc)]}, exit_code=1)

    return json_response(
        {
            "ok": not errors,
            "errors": errors,
            "request": request,
            "running": job_running(load_state()),
        },
        exit_code=0,
    )


def handle_start(payload_b64: str, mode: str) -> int:
    try:
        request, errors = validate_payload(parse_payload(payload_b64))
    except ValueError as exc:
        return json_response({"ok": False, "errors": [str(exc)]}, exit_code=1)

    existing_state = load_state()
    if job_running(existing_state):
        return json_response({"ok": False, "errors": ["A deployment is already running"]}, exit_code=0)

    if errors:
        return json_response({"ok": False, "errors": errors}, exit_code=0)

    ensure_runtime_dirs()
    write_stakkr_inputs(request)

    LOG_FILE.write_text("", encoding="utf-8")
    REQUEST_FILE.write_text(json.dumps(request, indent=2, sort_keys=True), encoding="utf-8")

    unit_name = f"cockpit-assisted-installer-local-{dt.datetime.now():%Y%m%d%H%M%S}"
    state = record_request_summary(request, mode, unit_name)
    state["status"] = "starting"
    save_state(state)

    proc = run(
        "systemd-run",
        "--unit",
        unit_name,
        "--description",
        "Cockpit Assisted Installer Local",
        "python3",
        str(HELPER_PATH),
        "run-job",
        "--mode",
        mode,
        "--unit-name",
        unit_name,
        check=False,
    )

    if proc.returncode != 0:
        state["status"] = "failed"
        state["endedAt"] = current_timestamp()
        state["error"] = proc.stderr.strip() or proc.stdout.strip() or "Failed to start job"
        save_state(state)
        return json_response({"ok": False, "errors": [state["error"]]}, exit_code=0)

    state["status"] = "running"
    save_state(state)
    return json_response({"ok": True, "unitName": unit_name, "request": request})


def handle_run_job(mode: str, unit_name: str) -> int:
    state = load_state()
    request = json.loads(REQUEST_FILE.read_text(encoding="utf-8"))
    command = build_ansible_command(request, mode)
    ensure_runtime_dirs()
    log_header = [
        f"[{current_timestamp()}] Starting {mode} for {request['topology']}",
        f"[{current_timestamp()}] Command: {' '.join(command)}",
        f"[{current_timestamp()}] HOME={RUNTIME_HOME_DIR}",
        f"[{current_timestamp()}] XDG_CACHE_HOME={RUNTIME_CACHE_DIR}",
        "",
    ]

    with LOG_FILE.open("a", encoding="utf-8") as log_handle:
        log_handle.write("\n".join(log_header))
        log_handle.flush()

        env = os.environ.copy()
        env["ANSIBLE_FORCE_COLOR"] = "false"
        env["PYTHONUNBUFFERED"] = "1"
        env["HOME"] = str(RUNTIME_HOME_DIR)
        env["XDG_CACHE_HOME"] = str(RUNTIME_CACHE_DIR)
        process = subprocess.Popen(
            command,
            cwd=request["stakkrRoot"],
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
        )
        rc = process.wait()

        log_handle.write(f"\n[{current_timestamp()}] ansible-playbook exited with rc={rc}\n")
        log_handle.flush()

    state.update(
        {
            "unitName": unit_name,
            "status": "succeeded" if rc == 0 else "failed",
            "endedAt": current_timestamp(),
            "returnCode": rc,
        }
    )
    save_state(state)
    return rc


def handle_status() -> int:
    state = load_state()
    unit_name = state.get("unitName", "")
    service_status = unit_status(unit_name)
    log_lines = tail_log()
    result = {
        "ok": True,
        "state": state,
        "running": service_status.get("ActiveState") in {"active", "activating"},
        "service": service_status,
        "logTail": log_lines,
        "currentTask": current_task_from_log(log_lines),
    }
    return json_response(result)


def handle_cancel() -> int:
    state = load_state()
    unit_name = state.get("unitName", "")
    if not unit_name:
        return json_response({"ok": False, "errors": ["No active deployment is recorded"]}, exit_code=0)

    run("systemctl", "stop", unit_name, check=False)
    state["status"] = "canceled"
    state["endedAt"] = current_timestamp()
    save_state(state)
    return json_response({"ok": True, "unitName": unit_name})


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    preflight = subparsers.add_parser("preflight")
    preflight.add_argument("--payload-b64", required=True)

    start = subparsers.add_parser("start")
    start.add_argument("--payload-b64", required=True)
    start.add_argument("--mode", choices=["deploy", "redeploy"], required=True)

    run_job = subparsers.add_parser("run-job")
    run_job.add_argument("--mode", choices=["deploy", "redeploy"], required=True)
    run_job.add_argument("--unit-name", required=True)

    subparsers.add_parser("status")
    subparsers.add_parser("cancel")

    args = parser.parse_args()

    try:
        if args.command == "preflight":
            return handle_preflight(args.payload_b64)
        if args.command == "start":
            return handle_start(args.payload_b64, args.mode)
        if args.command == "run-job":
            return handle_run_job(args.mode, args.unit_name)
        if args.command == "status":
            return handle_status()
        if args.command == "cancel":
            return handle_cancel()
    except Exception as exc:  # pragma: no cover - surfaced to cockpit
        return json_response({"ok": False, "errors": [str(exc)]}, exit_code=1)

    return 1


if __name__ == "__main__":
    sys.exit(main())
