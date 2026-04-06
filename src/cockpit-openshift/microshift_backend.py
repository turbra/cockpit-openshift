#!/usr/bin/env python3
"""
Dedicated Cockpit backend for MicroShift host deployment.

This helper keeps the MicroShift flow separate from the existing OpenShift
cluster installer. It validates a MicroShift-specific request, checks the
target host over SSH, renders the MicroShift configuration and install plan,
executes the remote RPM-based install workflow, and reports status back to the
MicroShift installer page.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import getpass
import ipaddress
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path


STATE_DIR = Path("/var/lib/cockpit-openshift")
STATE_FILE = STATE_DIR / "microshift-state.json"
REQUEST_FILE = STATE_DIR / "microshift-request.json"
LOG_FILE = STATE_DIR / "microshift-install.log"
SECRET_DIR = STATE_DIR / "microshift-secrets"
WORK_ROOT = STATE_DIR / "microshift-work"
HELPER_PATH = Path("/usr/share/cockpit/cockpit-openshift/microshift_backend.py")
STATE_SCHEMA = "microshift-v1"

NAME_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
VERSION_PATTERN = re.compile(r"^\d+\.\d+$")
NODEPORT_RANGE_PATTERN = re.compile(r"^\d{1,5}-\d{1,5}$")


def ensure_private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    path.chmod(0o700)


def write_private_file(path: Path, content: str) -> None:
    ensure_private_dir(path.parent)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o600)


def append_private_line(path: Path, line: str) -> None:
    ensure_private_dir(path.parent)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line.rstrip() + "\n")
    path.chmod(0o600)


def enforce_runtime_permissions() -> None:
    for path in [STATE_DIR, SECRET_DIR, WORK_ROOT]:
        if path.exists():
            path.chmod(0o700)
    for path in [STATE_FILE, REQUEST_FILE, LOG_FILE]:
        if path.exists():
            path.chmod(0o600)


def ensure_runtime_dirs() -> None:
    for path in [STATE_DIR, SECRET_DIR, WORK_ROOT]:
        ensure_private_dir(path)
    enforce_runtime_permissions()


def clear_runtime_state() -> None:
    for path in [STATE_FILE, REQUEST_FILE, LOG_FILE]:
        path.unlink(missing_ok=True)
    if SECRET_DIR.exists():
        shutil.rmtree(SECRET_DIR)


def load_state() -> dict:
    enforce_runtime_permissions()
    if not STATE_FILE.exists():
        return {}
    data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    if data.get("schema") == STATE_SCHEMA:
        return data
    clear_runtime_state()
    return {}


def save_state(data: dict) -> None:
    ensure_private_dir(STATE_DIR)
    write_private_file(STATE_FILE, json.dumps(data, indent=2, sort_keys=True))


def run(*argv: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(list(argv), check=check, capture_output=True, text=True)


def json_response(payload: dict, exit_code: int = 0) -> int:
    print(json.dumps(payload, indent=2, sort_keys=True))
    return exit_code


def current_timestamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def discover_owner() -> str:
    for candidate in [os.environ.get("SUDO_USER"), os.environ.get("USER")]:
        if candidate:
            return candidate
    try:
        return getpass.getuser()
    except Exception:
        return "local-admin"


def log_line(message: str) -> None:
    ensure_runtime_dirs()
    append_private_line(LOG_FILE, message)


def log_step(message: str) -> None:
    log_line(f"[STEP] {message}")


def log_command(message: str) -> None:
    log_line(f"[CMD] {message}")


def tail_log(lines: int = 120) -> list[str]:
    if not LOG_FILE.exists():
        return []
    return LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]


def current_task_from_log(log_lines: list[str]) -> str:
    for line in reversed(log_lines):
        if line.startswith("[STEP] "):
            return line[len("[STEP] "):].strip()
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
    result: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            result[key] = value
    return result


def job_running(state: dict) -> bool:
    unit_name = state.get("unitName", "")
    if not unit_name:
        return False
    status = unit_status(unit_name)
    return status.get("ActiveState") in {"active", "activating"}


def parse_payload(payload_b64: str) -> dict:
    try:
        raw = base64.b64decode(payload_b64.encode("utf-8"))
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Invalid payload: {exc}") from exc


def remote_target(request: dict) -> str:
    host = request["host"]
    return f"{host['sshUser']}@{host['address']}"


def ssh_base_argv(request: dict) -> list[str]:
    host = request["host"]
    return [
        "ssh",
        "-i",
        host["sshPrivateKeyFile"],
        "-p",
        str(host["sshPort"]),
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        remote_target(request),
    ]


def scp_base_argv(request: dict) -> list[str]:
    host = request["host"]
    return [
        "scp",
        "-i",
        host["sshPrivateKeyFile"],
        "-P",
        str(host["sshPort"]),
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
    ]


def run_logged(argv: list[str], *, step: str | None = None) -> subprocess.CompletedProcess:
    if step:
        log_step(step)
    log_command(" ".join(shlex.quote(part) for part in argv))
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    output_lines: list[str] = []
    assert process.stdout is not None
    for raw_line in process.stdout:
        line = raw_line.rstrip("\n")
        output_lines.append(line)
        log_line(line)
    rc = process.wait()
    if rc != 0:
        raise subprocess.CalledProcessError(rc, argv, output="\n".join(output_lines))
    return subprocess.CompletedProcess(argv, rc, stdout="\n".join(output_lines), stderr="")


def remote_run(request: dict, script: str, *, step: str | None = None) -> subprocess.CompletedProcess:
    remote_command = "sudo -n bash -lc " + shlex.quote(script)
    return run_logged(ssh_base_argv(request) + [remote_command], step=step)


def remote_query(request: dict, script: str) -> str:
    remote_command = "sudo -n bash -lc " + shlex.quote(script)
    proc = run(*(ssh_base_argv(request) + [remote_command]), check=False)
    if proc.returncode != 0:
        raise ValueError((proc.stderr or proc.stdout or "Remote command failed").strip())
    return proc.stdout.strip()


def scp_to_remote(request: dict, local_path: Path, remote_path: str, *, step: str | None = None) -> None:
    run_logged(scp_base_argv(request) + [str(local_path), f"{remote_target(request)}:{remote_path}"], step=step)


def scp_from_remote(request: dict, remote_path: str, local_path: Path, *, step: str | None = None) -> None:
    ensure_private_dir(local_path.parent)
    run_logged(scp_base_argv(request) + [f"{remote_target(request)}:{remote_path}", str(local_path)], step=step)
    local_path.chmod(0o600)


def render_microshift_config(request: dict) -> str:
    config = request["config"]
    lines = ["dns:", f"  baseDomain: {config['baseDomain']}"]

    if config["hostnameOverride"] or config["nodeIP"]:
        lines.append("node:")
        if config["hostnameOverride"]:
            lines.append(f"  hostnameOverride: {config['hostnameOverride']}")
        if config["nodeIP"]:
            lines.append(f"  nodeIP: {config['nodeIP']}")

    if config["subjectAltNames"]:
        lines.extend(
            [
                "apiServer:",
                "  subjectAltNames:",
            ]
        )
        lines.extend([f"    - {entry}" for entry in config["subjectAltNames"]])

    lines.extend(["network:", "  clusterNetwork:"])
    lines.extend([f"    - {entry}" for entry in config["clusterNetwork"]])
    lines.append("  serviceNetwork:")
    lines.extend([f"    - {entry}" for entry in config["serviceNetwork"]])
    lines.extend(
        [
            f"  serviceNodePortRange: {config['serviceNodePortRange']}",
            "debugging:",
            f"  logLevel: {config['logLevel']}",
        ]
    )
    return "\n".join(lines) + "\n"


def firewall_commands(request: dict) -> list[str]:
    cfg = request["config"]
    options = request["prerequisites"]
    commands = [
        "dnf install -y firewalld",
        "systemctl enable firewalld --now",
    ]
    for cidr in cfg["clusterNetwork"]:
        commands.append(f"firewall-cmd --permanent --zone=trusted --add-source={shlex.quote(cidr)}")
    commands.append("firewall-cmd --permanent --zone=trusted --add-source=169.254.169.1")
    if any(":" in cidr for cidr in cfg["clusterNetwork"]):
        commands.append("firewall-cmd --permanent --zone=trusted --add-source=fd01::/48")
    if options["exposeApiPort"]:
        commands.append("firewall-cmd --permanent --zone=public --add-port=6443/tcp")
    if options["exposeIngress"]:
        commands.extend(
            [
                "firewall-cmd --permanent --zone=public --add-port=80/tcp",
                "firewall-cmd --permanent --zone=public --add-port=443/tcp",
            ]
        )
    if options["exposeNodePorts"]:
        commands.extend(
            [
                f"firewall-cmd --permanent --zone=public --add-port={cfg['serviceNodePortRange']}/tcp",
                f"firewall-cmd --permanent --zone=public --add-port={cfg['serviceNodePortRange']}/udp",
            ]
        )
    if options["exposeMdns"]:
        commands.extend(
            [
                "firewall-cmd --permanent --zone=public --add-port=5353/udp",
                "firewall-cmd --permanent --zone=public --add-service=mdns",
            ]
        )
    commands.append("firewall-cmd --reload")
    return commands


def render_install_plan(request: dict) -> str:
    cfg = request["config"]
    host = request["host"]
    lines = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "",
        f"# MicroShift {request['microshiftVersion']} install plan for {request['deploymentName']}",
        f"# Target host: {host['sshUser']}@{host['address']}:{host['sshPort']}",
        "",
        "# Assumptions:",
        "# - The target host is a supported RHEL machine with passwordless sudo.",
        "# - The MicroShift and openshift-clients RPMs are already reachable through configured repositories.",
        "",
        "dnf install -y microshift openshift-clients" + (" firewalld" if request["prerequisites"]["manageFirewall"] else ""),
        "install -D -m 0600 pull-secret.json /etc/crio/openshift-pull-secret",
        "install -D -m 0644 config.yaml /etc/microshift/config.yaml",
    ]
    if request["prerequisites"]["manageFirewall"]:
        lines.append("")
        lines.append("# Firewall preparation")
        lines.extend(firewall_commands(request))
    lines.extend(
        [
            "",
            "# Start MicroShift",
            "systemctl enable --now microshift.service",
            "",
            "# Validate the single-node deployment",
            "oc --kubeconfig /var/lib/microshift/resources/kubeadmin/kubeconfig get nodes -o wide",
            "oc --kubeconfig /var/lib/microshift/resources/kubeadmin/kubeconfig get pods -A",
            "",
            f"# Base domain: {cfg['baseDomain']}",
            f"# Node IP override: {cfg['nodeIP'] or '<auto>'}",
            f"# Hostname override: {cfg['hostnameOverride'] or '<system hostname>'}",
        ]
    )
    return "\n".join(lines) + "\n"


def render_artifact_bundle(request: dict) -> dict:
    config_yaml = render_microshift_config(request)
    plan_script = render_install_plan(request)
    summary = {
        "deploymentKind": "microshift",
        "deploymentName": request["deploymentName"],
        "microshiftVersion": request["microshiftVersion"],
        "host": request["host"],
        "prerequisites": request["prerequisites"],
        "config": request["config"],
    }
    return {
        "ok": True,
        "artifacts": [
            {
                "name": "microshift-request.json",
                "content": json.dumps(summary, indent=2, sort_keys=True),
                "contentType": "application/json",
            },
            {
                "name": "microshift-config.yaml",
                "content": config_yaml,
                "contentType": "application/x-yaml",
            },
            {
                "name": "microshift-install-plan.sh",
                "content": plan_script,
                "contentType": "text/x-shellscript",
            },
        ],
    }


def public_request_view(request: dict) -> dict:
    data = json.loads(json.dumps(request))
    if "secretMaterial" in data:
        data["secretMaterial"] = {"pullSecret": "<redacted>"}
    return data


def validate_local_payload(payload: dict) -> tuple[dict, list[str]]:
    errors: list[str] = []

    deployment_name = str(payload.get("deploymentName", "")).strip()
    microshift_version = str(payload.get("microshiftVersion", "")).strip()
    host_payload = payload.get("host", {}) or {}
    host_address = str(host_payload.get("address", "")).strip()
    ssh_port = int(host_payload.get("sshPort", 0) or 0)
    ssh_user = str(host_payload.get("sshUser", "")).strip()
    ssh_private_key_file = str(host_payload.get("sshPrivateKeyFile", "")).strip()

    if not deployment_name:
        errors.append("Deployment name")
    elif not NAME_PATTERN.match(deployment_name):
        errors.append("Deployment name must contain only lowercase letters, numbers, and hyphens")

    if not VERSION_PATTERN.match(microshift_version):
        errors.append("MicroShift version")

    if not host_address:
        errors.append("Target host address")
    if ssh_port <= 0 or ssh_port > 65535:
        errors.append("SSH port")
    if not ssh_user:
        errors.append("SSH user")
    if not ssh_private_key_file or not Path(ssh_private_key_file).exists():
        errors.append("SSH private key file")

    pull_secret_value = str(payload.get("pullSecretValue", "")).strip()
    pull_secret_file = str(payload.get("pullSecretFile", "")).strip()
    if pull_secret_value:
        try:
            json.loads(pull_secret_value)
        except json.JSONDecodeError:
            errors.append("Pull secret")
    elif not pull_secret_file or not Path(pull_secret_file).exists():
        errors.append("Pull secret")

    config_payload = payload.get("config", {}) or {}
    base_domain = str(config_payload.get("baseDomain", "")).strip()
    hostname_override = str(config_payload.get("hostnameOverride", "")).strip()
    node_ip = str(config_payload.get("nodeIP", "")).strip()
    cluster_network = [str(entry).strip() for entry in (config_payload.get("clusterNetwork", []) or []) if str(entry).strip()]
    service_network = [str(entry).strip() for entry in (config_payload.get("serviceNetwork", []) or []) if str(entry).strip()]
    subject_alt_names = [str(entry).strip() for entry in (config_payload.get("subjectAltNames", []) or []) if str(entry).strip()]
    service_node_port_range = str(config_payload.get("serviceNodePortRange", "")).strip()
    log_level = str(config_payload.get("logLevel", "Normal")).strip() or "Normal"

    if not base_domain:
        errors.append("Base domain")
    if node_ip:
        try:
            ipaddress.ip_address(node_ip)
        except ValueError:
            errors.append("Node IP")
    for cidr in cluster_network:
        try:
            ipaddress.ip_network(cidr, strict=False)
        except ValueError:
            errors.append(f"Cluster network CIDR {cidr}")
    if not cluster_network:
        errors.append("Cluster network")
    for cidr in service_network:
        try:
            ipaddress.ip_network(cidr, strict=False)
        except ValueError:
            errors.append(f"Service network CIDR {cidr}")
    if not service_network:
        errors.append("Service network")
    if not NODEPORT_RANGE_PATTERN.match(service_node_port_range):
        errors.append("Service NodePort range")
    else:
        start_text, end_text = service_node_port_range.split("-", 1)
        start = int(start_text)
        end = int(end_text)
        if start <= 0 or end > 65535 or start > end:
            errors.append("Service NodePort range")
    if log_level not in {"Normal", "Debug", "Trace", "TraceAll"}:
        errors.append("Log level")

    prerequisites_payload = payload.get("prerequisites", {}) or {}
    prerequisites = {
        "manageFirewall": bool(prerequisites_payload.get("manageFirewall", True)),
        "exposeApiPort": bool(prerequisites_payload.get("exposeApiPort", True)),
        "exposeIngress": bool(prerequisites_payload.get("exposeIngress", True)),
        "exposeNodePorts": bool(prerequisites_payload.get("exposeNodePorts", False)),
        "exposeMdns": bool(prerequisites_payload.get("exposeMdns", False)),
    }

    normalized = {
        "deploymentKind": "microshift",
        "deploymentName": deployment_name,
        "deploymentId": deployment_name,
        "microshiftVersion": microshift_version,
        "host": {
            "address": host_address,
            "sshPort": ssh_port,
            "sshUser": ssh_user,
            "sshPrivateKeyFile": ssh_private_key_file,
        },
        "config": {
            "baseDomain": base_domain,
            "hostnameOverride": hostname_override,
            "nodeIP": node_ip,
            "subjectAltNames": subject_alt_names,
            "clusterNetwork": cluster_network,
            "serviceNetwork": service_network,
            "serviceNodePortRange": service_node_port_range,
            "logLevel": log_level,
        },
        "prerequisites": prerequisites,
        "secretInputs": {
            "pullSecretSource": "inline" if pull_secret_value else "file",
            "pullSecretFile": pull_secret_file,
        },
        "secretMaterial": {
            "pullSecret": pull_secret_value if pull_secret_value else Path(pull_secret_file).read_text(encoding="utf-8"),
        },
    }
    return normalized, errors


def validate_remote_host(request: dict) -> list[str]:
    errors: list[str] = []

    for binary in ["ssh", "scp"]:
        proc = run(binary, "-V", check=False)
        if proc.returncode != 0 and binary == "scp":
            errors.append(binary)
        if proc.returncode != 0 and binary == "ssh":
            errors.append(binary)

    if errors:
        return errors

    try:
        remote_run(request, "true", step="Checking SSH connectivity and passwordless sudo")
    except Exception as exc:
        return [f"Unable to reach the target host with passwordless sudo: {exc}"]

    try:
        os_release = remote_query(request, "cat /etc/os-release")
    except Exception as exc:
        return [f"Unable to read /etc/os-release on the target host: {exc}"]

    fields: dict[str, str] = {}
    for line in os_release.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            fields[key] = value.strip().strip('"')
    if fields.get("ID") != "rhel":
        errors.append("Target host must be Red Hat Enterprise Linux")
    major = (fields.get("VERSION_ID", "").split(".", 1)[0] if fields.get("VERSION_ID") else "")
    if major not in {"9", "10"}:
        errors.append("Target host must be RHEL 9 or RHEL 10")

    try:
        arch = remote_query(request, "uname -m")
    except Exception as exc:
        errors.append(f"Unable to determine target architecture: {exc}")
    else:
        if arch not in {"x86_64", "aarch64"}:
            errors.append("Target architecture must be x86_64 or aarch64")

    package_checks = {
        "microshift": "dnf -q list --available microshift >/dev/null 2>&1 || dnf -q info microshift >/dev/null 2>&1",
        "openshift-clients": "dnf -q list --available openshift-clients >/dev/null 2>&1 || dnf -q info openshift-clients >/dev/null 2>&1",
    }
    for label, script in package_checks.items():
        proc = run(*(ssh_base_argv(request) + ["sudo -n bash -lc " + shlex.quote(script)]), check=False)
        if proc.returncode != 0:
            errors.append(
                f"{label} RPM is not currently available on the target host. Register the host and enable the required repositories first."
            )

    return errors


def validate_payload(payload: dict) -> tuple[dict, list[str]]:
    normalized, errors = validate_local_payload(payload)
    if errors:
        return normalized, errors
    return normalized, validate_remote_host(normalized)


def work_dir(request: dict) -> Path:
    return WORK_ROOT / request["deploymentId"]


def generated_dir(request: dict) -> Path:
    return work_dir(request) / "generated"


def config_path(request: dict) -> Path:
    return generated_dir(request) / "config.yaml"


def plan_path(request: dict) -> Path:
    return generated_dir(request) / "install-plan.sh"


def local_pull_secret_path(request: dict) -> Path:
    return SECRET_DIR / f"{request['deploymentId']}-pull-secret.json"


def record_request_summary(request: dict, unit_name: str) -> dict:
    return {
        "schema": STATE_SCHEMA,
        "deploymentKind": "microshift",
        "deploymentName": request["deploymentName"],
        "deploymentId": request["deploymentId"],
        "microshiftVersion": request["microshiftVersion"],
        "host": request["host"],
        "mode": "deploy",
        "unitName": unit_name,
        "startedAt": current_timestamp(),
        "status": "starting",
    }


def host_label(request: dict) -> str:
    host = request["host"]
    return f"{host['sshUser']}@{host['address']}:{host['sshPort']}"


def resolve_remote_kubeconfig(request: dict) -> tuple[str, str]:
    configured_name = request["config"]["hostnameOverride"]
    system_name = remote_query(request, "hostname -f 2>/dev/null || hostname -s 2>/dev/null || hostname")
    candidates = []
    if configured_name:
        candidates.append(f"/var/lib/microshift/resources/kubeadmin/{configured_name}/kubeconfig")
    if system_name:
        candidates.append(f"/var/lib/microshift/resources/kubeadmin/{system_name}/kubeconfig")
    candidates.append("/var/lib/microshift/resources/kubeadmin/kubeconfig")
    for candidate in candidates:
        proc = run(*(ssh_base_argv(request) + [f"sudo -n test -f {shlex.quote(candidate)}"]), check=False)
        if proc.returncode == 0:
            return candidate, system_name or configured_name or request["host"]["address"]
    raise ValueError("MicroShift kubeconfig was not found on the target host")


def install_access(request: dict, local_kubeconfig: Path, remote_kubeconfig: str, server_name: str) -> dict:
    server_host = request["config"]["nodeIP"] or server_name or request["host"]["address"]
    return {
        "apiEndpoint": f"https://{server_host}:6443",
        "host": host_label(request),
        "kubeconfigPath": str(local_kubeconfig),
        "remoteKubeconfigPath": remote_kubeconfig,
    }


def wait_for_microshift(request: dict) -> None:
    remote_run(
        request,
        """
for _ in $(seq 1 60); do
    if systemctl is-active --quiet microshift.service; then
        exit 0
    fi
    sleep 10
done
systemctl status microshift.service --no-pager || true
exit 1
""".strip(),
        step="Waiting for microshift.service to become active",
    )


def validate_microshift(request: dict) -> None:
    remote_run(
        request,
        """
for _ in $(seq 1 60); do
    if oc --kubeconfig /var/lib/microshift/resources/kubeadmin/kubeconfig get nodes -o json >/tmp/microshift-nodes.json 2>/tmp/microshift-nodes.err; then
        python3 - <<'PY'
import json
from pathlib import Path
data = json.loads(Path('/tmp/microshift-nodes.json').read_text())
for node in data.get('items', []):
    ready = {entry['type']: entry['status'] for entry in node.get('status', {}).get('conditions', [])}.get('Ready')
    if ready == 'True':
        raise SystemExit(0)
raise SystemExit(1)
PY
    fi
    sleep 10
done
cat /tmp/microshift-nodes.err 2>/dev/null || true
oc --kubeconfig /var/lib/microshift/resources/kubeadmin/kubeconfig get nodes -o wide || true
exit 1
""".strip(),
        step="Validating node readiness with oc",
    )
    remote_run(
        request,
        "oc --kubeconfig /var/lib/microshift/resources/kubeadmin/kubeconfig get pods -A",
        step="Collecting post-install pod state",
    )


def handle_preflight(payload_b64: str) -> int:
    try:
        request, errors = validate_payload(parse_payload(payload_b64))
    except ValueError as exc:
        return json_response({"ok": False, "errors": [str(exc)]}, exit_code=0)
    return json_response({"ok": not errors, "errors": errors, "request": public_request_view(request), "running": job_running(load_state())})


def handle_artifacts(payload_b64: str | None, current: bool) -> int:
    if current:
        if not REQUEST_FILE.exists():
            return json_response({"ok": False, "errors": ["No current MicroShift deployment request is recorded"]}, exit_code=0)
        request = json.loads(REQUEST_FILE.read_text(encoding="utf-8"))
        return json_response(render_artifact_bundle(request))
    if not payload_b64:
        return json_response({"ok": False, "errors": ["Missing payload"]}, exit_code=0)
    try:
        request, errors = validate_payload(parse_payload(payload_b64))
    except ValueError as exc:
        return json_response({"ok": False, "errors": [str(exc)]}, exit_code=0)
    if errors:
        return json_response({"ok": False, "errors": errors}, exit_code=0)
    return json_response(render_artifact_bundle(request))


def handle_start(payload_b64: str) -> int:
    try:
        request, errors = validate_payload(parse_payload(payload_b64))
    except ValueError as exc:
        return json_response({"ok": False, "errors": [str(exc)]}, exit_code=0)

    if job_running(load_state()):
        return json_response({"ok": False, "errors": ["A MicroShift deployment is already running"]}, exit_code=0)
    if errors:
        return json_response({"ok": False, "errors": errors}, exit_code=0)

    clear_runtime_state()
    ensure_runtime_dirs()
    request["createdAt"] = current_timestamp()
    request["owner"] = discover_owner()
    request["provider"] = "Existing RHEL host"
    request["region"] = request["host"]["address"]

    ensure_private_dir(generated_dir(request))
    write_private_file(local_pull_secret_path(request), request["secretMaterial"]["pullSecret"].strip() + "\n")
    write_private_file(config_path(request), render_microshift_config(request))
    write_private_file(plan_path(request), render_install_plan(request))

    write_private_file(REQUEST_FILE, json.dumps(request, indent=2, sort_keys=True))
    write_private_file(LOG_FILE, "")

    unit_name = f"cockpit-microshift-{dt.datetime.now():%Y%m%d%H%M%S}"
    state = record_request_summary(request, unit_name)
    save_state(state)

    proc = run(
        "systemd-run",
        "--unit",
        unit_name,
        "--description",
        "Cockpit MicroShift",
        "python3",
        str(HELPER_PATH),
        "run-job",
        "--unit-name",
        unit_name,
        check=False,
    )
    if proc.returncode != 0:
        state["status"] = "failed"
        state["endedAt"] = current_timestamp()
        state["error"] = proc.stderr.strip() or proc.stdout.strip() or "Failed to start MicroShift job"
        save_state(state)
        return json_response({"ok": False, "errors": [state["error"]]})

    state["status"] = "running"
    save_state(state)
    return json_response({"ok": True, "unitName": unit_name, "request": public_request_view(request)})


def run_install_job(unit_name: str) -> int:
    request = json.loads(REQUEST_FILE.read_text(encoding="utf-8"))
    output_dir = generated_dir(request)
    local_kubeconfig = output_dir / "kubeconfig"
    log_step(f"Starting MicroShift deployment for {request['deploymentName']} on {host_label(request)}")

    rc = 0
    try:
        remote_errors = validate_remote_host(request)
        if remote_errors:
            raise ValueError("; ".join(remote_errors))
        package_names = "microshift openshift-clients"
        if request["prerequisites"]["manageFirewall"]:
            package_names += " firewalld"
        remote_run(request, f"dnf install -y {package_names}", step="Installing MicroShift and required RPMs")
        if request["prerequisites"]["manageFirewall"]:
            remote_run(request, "\n".join(firewall_commands(request)), step="Configuring firewalld for MicroShift")

        remote_pull_secret = f"/tmp/{request['deploymentId']}-pull-secret.json"
        remote_config = f"/tmp/{request['deploymentId']}-config.yaml"
        scp_to_remote(request, local_pull_secret_path(request), remote_pull_secret, step="Uploading pull secret to the target host")
        scp_to_remote(request, config_path(request), remote_config, step="Uploading MicroShift config to the target host")
        remote_run(
            request,
            f"""
install -D -m 0600 {shlex.quote(remote_pull_secret)} /etc/crio/openshift-pull-secret
install -D -m 0644 {shlex.quote(remote_config)} /etc/microshift/config.yaml
rm -f {shlex.quote(remote_pull_secret)} {shlex.quote(remote_config)}
""".strip(),
            step="Installing MicroShift input files on the target host",
        )
        remote_run(request, "systemctl enable --now microshift.service", step="Starting microshift.service")
        wait_for_microshift(request)
        validate_microshift(request)

        remote_kubeconfig, server_name = resolve_remote_kubeconfig(request)
        remote_run(
            request,
            f"cat {shlex.quote(remote_kubeconfig)}",
            step="Reading generated kubeconfig from the target host",
        )
        ensure_private_dir(local_kubeconfig.parent)
        proc = run(*(ssh_base_argv(request) + [f"sudo -n cat {shlex.quote(remote_kubeconfig)}"]), check=False)
        if proc.returncode != 0:
            raise ValueError(proc.stderr.strip() or proc.stdout.strip() or "Unable to copy kubeconfig from the target host")
        write_private_file(local_kubeconfig, proc.stdout)

        state = load_state()
        state["installAccess"] = install_access(request, local_kubeconfig, remote_kubeconfig, server_name)
        save_state(state)
        log_step("MicroShift installation completed successfully")
    except Exception as exc:  # pragma: no cover
        log_line(f"[ERROR] {exc}")
        rc = 1

    state = load_state()
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


def handle_run_job(unit_name: str) -> int:
    ensure_runtime_dirs()
    return run_install_job(unit_name)


def handle_status() -> int:
    state = load_state()
    service_status = unit_status(state.get("unitName", ""))
    request = None
    if REQUEST_FILE.exists():
        try:
            request = public_request_view(json.loads(REQUEST_FILE.read_text(encoding="utf-8")))
        except Exception:
            request = None
    log_lines = tail_log()
    return json_response(
        {
            "ok": True,
            "state": state,
            "request": request,
            "running": service_status.get("ActiveState") in {"active", "activating"},
            "service": service_status,
            "logTail": log_lines,
            "currentTask": current_task_from_log(log_lines),
        }
    )


def handle_cancel() -> int:
    state = load_state()
    unit_name = state.get("unitName", "")
    if not unit_name:
        return json_response({"ok": False, "errors": ["No active MicroShift deployment is recorded"]}, exit_code=0)
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

    artifacts = subparsers.add_parser("artifacts")
    artifacts.add_argument("--payload-b64")
    artifacts.add_argument("--current", action="store_true")

    start = subparsers.add_parser("start")
    start.add_argument("--payload-b64", required=True)

    run_job = subparsers.add_parser("run-job")
    run_job.add_argument("--unit-name", required=True)

    subparsers.add_parser("status")
    subparsers.add_parser("cancel")

    args = parser.parse_args()
    try:
        if args.command == "preflight":
            return handle_preflight(args.payload_b64)
        if args.command == "artifacts":
            return handle_artifacts(args.payload_b64, args.current)
        if args.command == "start":
            return handle_start(args.payload_b64)
        if args.command == "run-job":
            return handle_run_job(args.unit_name)
        if args.command == "status":
            return handle_status()
        if args.command == "cancel":
            return handle_cancel()
    except Exception as exc:  # pragma: no cover
        return json_response({"ok": False, "errors": [str(exc)]}, exit_code=1)
    return 1


if __name__ == "__main__":
    sys.exit(main())
