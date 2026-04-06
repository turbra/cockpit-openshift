#!/usr/bin/env python3
"""
Self-contained Cockpit backend for local OpenShift installation on a KVM host.

This helper owns the local runtime state for cockpit-openshift.
It validates user input, downloads installer binaries, renders install-config
and agent-config, manages local libvirt disks/domains, drives the OpenShift
installer lifecycle, and reports job status back to the UI.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import getpass
import hashlib
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


STATE_DIR = Path("/var/lib/cockpit-openshift")
STATE_FILE = STATE_DIR / "state.json"
REQUEST_FILE = STATE_DIR / "request.json"
LOG_FILE = STATE_DIR / "install.log"
SECRET_DIR = STATE_DIR / "secrets"
RUNTIME_HOME_DIR = STATE_DIR / "home"
RUNTIME_CACHE_DIR = STATE_DIR / "cache"
WORK_ROOT = STATE_DIR / "work"
LIBVIRT_MEDIA_DIR = Path("/var/lib/libvirt/images")
HELPER_PATH = Path("/usr/share/cockpit/cockpit-openshift-beta/installer_backend.py")
CLUSTER_METADATA_FILE = "cluster-metadata.json"
STATE_SCHEMA = "standalone-v1"

SUPPORTED_ARCH = "x86_64"
DEFAULT_VERSION = "OpenShift 4.21.7"
DEFAULT_PLATFORM_INTEGRATION = "No platform integration"
DEFAULT_BRIDGE_NAME = "bridge0"
DEFAULT_PERFORMANCE_DOMAIN = "none"
DEFAULT_STORAGE_POOL = ""
DEFAULT_PULL_SECRET_PATH = ""
DEFAULT_SSH_PUBLIC_KEY_PATH = ""

VERSION_PATTERN = re.compile(r"^OpenShift (?P<version>\d+\.\d+\.\d+)$")
CLUSTER_NAME_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
MAC_ADDRESS_PATTERN = re.compile(r"^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$")

OPENSHIFT_MIRROR_BASE_URL = "https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp"
PERFORMANCE_DOMAINS = {
    "none": {},
    "gold": {"cpu_shares": 512},
    "silver": {"cpu_shares": 333},
    "bronze": {"cpu_shares": 167},
}
GUEST_PRIMARY_INTERFACE = "eth0"


def enforce_runtime_permissions() -> None:
    for path in [STATE_DIR, SECRET_DIR, RUNTIME_HOME_DIR, RUNTIME_CACHE_DIR, WORK_ROOT]:
        if path.exists():
            path.chmod(0o700)
    for path in [STATE_FILE, REQUEST_FILE, LOG_FILE]:
        if path.exists():
            path.chmod(0o600)


def load_state() -> dict:
    enforce_runtime_permissions()
    if not STATE_FILE.exists():
        return {}
    data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    if data.get("schema") == STATE_SCHEMA:
        return data

    unit_name = data.get("unitName", "")
    status = unit_status(unit_name) if unit_name else {}
    if status.get("ActiveState") in {"active", "activating"}:
        return data

    clear_runtime_state()
    return {}


def save_state(data: dict) -> None:
    ensure_private_dir(STATE_DIR)
    write_private_file(STATE_FILE, json.dumps(data, indent=2, sort_keys=True))


def clear_runtime_state() -> None:
    for path in [STATE_FILE, REQUEST_FILE, LOG_FILE]:
        path.unlink(missing_ok=True)
    if SECRET_DIR.exists():
        shutil.rmtree(SECRET_DIR)


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


def ensure_runtime_dirs() -> None:
    for path in [STATE_DIR, SECRET_DIR, RUNTIME_HOME_DIR, RUNTIME_CACHE_DIR, WORK_ROOT]:
        ensure_private_dir(path)
    enforce_runtime_permissions()


def run(*argv: str, check: bool = True, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(list(argv), check=check, capture_output=True, text=True, env=env)


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


def discover_owner() -> str:
    for candidate in [os.environ.get("SUDO_USER"), os.environ.get("USER")]:
        if candidate:
            return candidate
    try:
        return getpass.getuser()
    except Exception:
        return "local-admin"


def channel_group(version: str) -> str:
    parts = version.split(".")
    if len(parts) >= 2:
        return f"stable-{parts[0]}.{parts[1]}"
    return "stable"


def cluster_metadata_path(work_dir: Path) -> Path:
    return work_dir / CLUSTER_METADATA_FILE


def cluster_metadata_view(request: dict) -> dict:
    return {
        "createdAt": request.get("createdAt", current_timestamp()),
        "owner": request.get("owner", discover_owner()),
        "openshiftVersion": request.get("openshiftVersion", DEFAULT_VERSION),
        "openshiftRelease": request.get("openshiftRelease", ""),
        "provider": request.get("provider", "Local libvirt / KVM"),
        "region": request.get("region", "Local KVM host"),
        "channelGroup": request.get("channelGroup", channel_group(request.get("openshiftRelease", ""))),
        "partnerIntegration": request.get("partnerIntegration", DEFAULT_PLATFORM_INTEGRATION),
        "nodeVcpus": request.get("compute", {}).get("nodeVcpus", 0),
        "memoryMb": request.get("compute", {}).get("nodeMemoryMb", 0),
        "operators": request.get("operators", []),
    }


def runtime_env() -> dict:
    env = os.environ.copy()
    env["HOME"] = str(RUNTIME_HOME_DIR)
    env["XDG_CACHE_HOME"] = str(RUNTIME_CACHE_DIR)
    env["PYTHONUNBUFFERED"] = "1"
    return env


def log_line(message: str) -> None:
    ensure_runtime_dirs()
    append_private_line(LOG_FILE, message)


def log_step(message: str) -> None:
    log_line(f"[STEP] {message}")


def log_command(message: str) -> None:
    log_line(f"[CMD] {message}")


def log_output(line: str) -> None:
    log_line(line)


def run_logged(argv: list[str], *, cwd: Path | None = None, env: dict | None = None, step: str | None = None) -> subprocess.CompletedProcess:
    if step:
        log_step(step)
    log_command(" ".join(argv))

    process = subprocess.Popen(
        argv,
        cwd=str(cwd) if cwd else None,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    output_lines: list[str] = []
    assert process.stdout is not None
    for raw_line in process.stdout:
        line = raw_line.rstrip("\n")
        output_lines.append(line)
        log_output(line)

    rc = process.wait()
    if rc != 0:
        raise subprocess.CalledProcessError(rc, argv, output="\n".join(output_lines))

    return subprocess.CompletedProcess(argv, rc, stdout="\n".join(output_lines), stderr="")


def current_task_from_log(log_lines: list[str]) -> str:
    for line in reversed(log_lines):
        if line.startswith("[STEP] "):
            return line[len("[STEP] "):].strip()
        if line.startswith("TASK ["):
            return line.strip()
        if line.startswith("PLAY ["):
            return line.strip()
    return ""


def tail_log(lines: int = 120) -> list[str]:
    if not LOG_FILE.exists():
        return []
    content = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
    return content[-lines:]


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


def normalize_topology(control_plane_count: int) -> str:
    if control_plane_count == 1:
        return "sno"
    if control_plane_count == 3:
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


def validate_mac(value: str, field_name: str, errors: list[str]) -> None:
    if not MAC_ADDRESS_PATTERN.match(value):
        errors.append(field_name)


def query_storage_pools() -> list[dict]:
    proc = run("virsh", "pool-list", "--all", "--name", check=True)
    pools: list[dict] = []
    for name in [line.strip() for line in proc.stdout.splitlines() if line.strip()]:
        info = run("virsh", "pool-info", name, check=False)
        xml = run("virsh", "pool-dumpxml", name, check=False)
        if xml.returncode != 0:
            continue
        root = ET.fromstring(xml.stdout)
        pool_type = root.attrib.get("type", "")
        target_path = root.findtext("./target/path", default="")
        source_name = root.findtext("./source/name", default="")
        active = any(line.strip() == "State:          running" or line.strip() == "State:           running" for line in info.stdout.splitlines())
        pools.append(
            {
                "name": name,
                "type": pool_type,
                "active": active,
                "targetPath": target_path,
                "sourceName": source_name,
                "supported": pool_type in {"dir", "logical"},
            }
        )
    return pools


def query_bridges() -> list[str]:
    proc = run("ip", "-j", "link", "show", "type", "bridge", check=True)
    data = json.loads(proc.stdout)
    return [entry["ifname"] for entry in data if entry.get("ifname")]


def choose_default_pool(pools: list[dict]) -> str:
    for preferred in ["ocptb", "default"]:
        for pool in pools:
            if pool["name"] == preferred and pool["supported"]:
                return pool["name"]
    for pool in pools:
        if pool["supported"] and pool["active"]:
            return pool["name"]
    for pool in pools:
        if pool["supported"]:
            return pool["name"]
    return ""


def choose_default_bridge(bridges: list[str]) -> str:
    if DEFAULT_BRIDGE_NAME in bridges:
        return DEFAULT_BRIDGE_NAME
    return bridges[0] if bridges else DEFAULT_BRIDGE_NAME


def split_cluster_id(cluster_id: str) -> tuple[str, str]:
    parts = cluster_id.split(".", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid cluster id {cluster_id}")
    return parts[0], parts[1]


def derive_pool_map() -> dict[str, dict]:
    return {pool["name"]: pool for pool in query_storage_pools()}


def determine_pool(name: str) -> dict:
    pool_map = derive_pool_map()
    if name not in pool_map:
        raise ValueError(f"Storage pool {name} was not found")
    pool = pool_map[name]
    if not pool["supported"]:
        raise ValueError(f"Storage pool {name} type {pool['type']} is not supported")
    return pool


def virsh_domain_names() -> list[str]:
    proc = run("virsh", "list", "--all", "--name", check=True)
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def record_request_summary(request: dict, mode: str, unit_name: str) -> dict:
    return {
        "schema": STATE_SCHEMA,
        "clusterName": request["clusterName"],
        "baseDomain": request["baseDomain"],
        "topology": request["topology"],
        "platformType": request["platformType"],
        "openshiftRelease": request["openshiftRelease"],
        "mode": mode,
        "unitName": unit_name,
        "startedAt": current_timestamp(),
        "requestedNetwork": request["network"],
        "compute": request["compute"],
        "storage": request["storage"],
        "secretInputs": request["secretInputs"],
    }


def public_request_view(request: dict) -> dict:
    result = {
        "clusterName": request["clusterName"],
        "baseDomain": request["baseDomain"],
        "createdAt": request.get("createdAt", ""),
        "owner": request.get("owner", ""),
        "cpuArchitecture": request["cpuArchitecture"],
        "openshiftVersion": request["openshiftVersion"],
        "openshiftRelease": request["openshiftRelease"],
        "channelGroup": request.get("channelGroup", channel_group(request["openshiftRelease"])),
        "topology": request["topology"],
        "platformType": request["platformType"],
        "provider": request.get("provider", "Local libvirt / KVM"),
        "region": request.get("region", "Local KVM host"),
        "partnerIntegration": request.get("partnerIntegration", DEFAULT_PLATFORM_INTEGRATION),
        "operators": request.get("operators", []),
        "hostsNetworkConfiguration": request["hostsNetworkConfiguration"],
        "network": request["network"],
        "compute": request["compute"],
        "storage": request["storage"],
        "hosts": request.get("hosts", []),
        "secretInputs": request["secretInputs"],
    }
    if "secretFiles" in result["secretInputs"]:
        del result["secretInputs"]["secretFiles"]
    return result


def preview_request_from_runtime(request: dict) -> dict:
    result = dict(request)
    if "secretMaterial" not in result and "secretFiles" in result:
        result["secretMaterial"] = {
            "pullSecret": Path(result["secretFiles"]["pullSecretFile"]).read_text(encoding="utf-8").strip(),
            "sshPublicKey": Path(result["secretFiles"]["sshPublicKeyFile"]).read_text(encoding="utf-8").strip(),
        }
    return result


def secret_material(request: dict) -> tuple[str, str]:
    if "secretMaterial" in request:
        return (
            request["secretMaterial"]["pullSecret"].strip(),
            request["secretMaterial"]["sshPublicKey"].strip(),
        )
    return (
        Path(request["secretFiles"]["pullSecretFile"]).read_text(encoding="utf-8").strip(),
        Path(request["secretFiles"]["sshPublicKeyFile"]).read_text(encoding="utf-8").strip(),
    )


def read_optional_file(path_str: str) -> str:
    if not path_str:
        return ""
    path = Path(path_str)
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8").strip()


def derive_request_paths(request: dict) -> dict:
    cluster_id = f"{request['clusterName']}.{request['baseDomain']}"
    work_dir = WORK_ROOT / cluster_id
    install_dir = work_dir / "generated" / "ocp"
    tools_dir = work_dir / "tools" / request["openshiftRelease"]
    downloads_dir = tools_dir / "downloads"
    bin_dir = tools_dir / "bin"
    iso_filename = f"{request['clusterName']}-agent.{SUPPORTED_ARCH}.iso"
    return {
        "clusterId": cluster_id,
        "workDir": work_dir,
        "installDir": install_dir,
        "downloadsDir": downloads_dir,
        "binDir": bin_dir,
        "installerBinary": bin_dir / "openshift-install",
        "ocBinary": bin_dir / "oc",
        "localIso": install_dir / f"agent.{SUPPORTED_ARCH}.iso",
        "hypervisorIso": LIBVIRT_MEDIA_DIR / iso_filename,
        "kubeconfig": install_dir / "auth" / "kubeconfig",
    }


def deterministic_mac(*parts: str) -> str:
    digest = hashlib.sha256(":".join(parts).encode("utf-8")).digest()
    return "52:54:00:{:02x}:{:02x}:{:02x}".format(digest[0], digest[1], digest[2])


def topology_node_names(topology: str) -> list[str]:
    if topology == "sno":
        return ["ocp-control-01"]
    return ["ocp-master-01", "ocp-master-02", "ocp-master-03"]


def build_nodes(request: dict, pool: dict) -> list[dict]:
    cluster_id = f"{request['clusterName']}.{request['baseDomain']}"
    prefix_length = ipaddress.ip_network(request["network"]["machineCidr"], strict=False).prefixlen
    pool_type = pool["type"]
    disk_format = "raw" if pool_type == "logical" else "qcow2"
    nodes: list[dict] = []

    for index, host in enumerate(request["hosts"]):
        name = host["name"]
        serial_seed = hashlib.sha256(f"{cluster_id}:{name}:disk".encode("utf-8")).hexdigest()[:12]
        disk_basename = f"{name}{'.qcow2' if disk_format == 'qcow2' else ''}"
        if pool_type == "logical":
            disk_path = str(Path(pool["targetPath"]) / name)
        else:
            disk_path = str(Path(pool["targetPath"]) / disk_basename)

        interfaces = [
            {
                "name": request["network"]["primaryInterfaceName"],
                "bridge": request["network"]["bridgeName"],
                "macAddress": host.get("macAddress") or deterministic_mac(cluster_id, name, request["network"]["primaryInterfaceName"]),
            }
        ]
        if request["network"].get("secondaryBridgeName"):
            interfaces.append(
                {
                    "name": request["network"]["secondaryInterfaceName"],
                    "bridge": request["network"]["secondaryBridgeName"],
                    "macAddress": deterministic_mac(cluster_id, name, request["network"]["secondaryInterfaceName"]),
                }
            )

        nodes.append(
            {
                "name": name,
                "role": host.get("role", "control-plane"),
                "macAddress": interfaces[0]["macAddress"],
                "interfaces": interfaces,
                "ipAddress": host["ipAddress"],
                "networkYaml": host["networkYaml"].rstrip(),
                "prefixLength": prefix_length,
                "vcpus": request["compute"]["nodeVcpus"],
                "memoryMb": request["compute"]["nodeMemoryMb"],
                "diskPath": disk_path,
                "diskFormat": disk_format,
                "diskSizeGb": request["storage"]["diskSizeGb"],
                "diskSerial": f"{name.replace('-', '')}-{serial_seed}",
            }
        )

    return nodes


def indent_block(content: str, prefix: str) -> list[str]:
    return [prefix + line if line else prefix.rstrip() for line in content.splitlines()]


def render_install_config(request: dict, nodes: list[dict]) -> str:
    pull_secret, ssh_key = secret_material(request)
    platform_block = "  none: {}"
    if request["platformType"] == "baremetal":
        platform_block = "\n".join(
            [
                "  baremetal:",
                "    apiVIPs:",
                f"      - {request['network']['apiVip']}",
                "    ingressVIPs:",
                f"      - {request['network']['ingressVip']}",
            ]
        )

    cluster_network = "    - cidr: 10.128.0.0/14\n      hostPrefix: 23"
    service_network = "    - 172.30.0.0/16"

    return "\n".join(
        [
            "apiVersion: v1",
            f"baseDomain: {request['baseDomain']}",
            "metadata:",
            f"  name: {request['clusterName']}",
            "compute:",
            "  - name: worker",
            "    replicas: 0",
            "controlPlane:",
            "  name: master",
            f"  replicas: {len(nodes)}",
            "networking:",
            "  networkType: OVNKubernetes",
            "  machineNetwork:",
            f"    - cidr: {request['network']['machineCidr']}",
            "  clusterNetwork:",
            cluster_network,
            "  serviceNetwork:",
            service_network,
            "platform:",
            platform_block,
            "pullSecret: >-",
            f"  {pull_secret}",
            "sshKey: >-",
            f"  {ssh_key}",
            "",
        ]
    )


def render_agent_config(request: dict, nodes: list[dict]) -> str:
    lines = [
        "apiVersion: v1alpha1",
        "kind: AgentConfig",
        f"rendezvousIP: {nodes[0]['ipAddress']}",
        "hosts:",
    ]

    for node in nodes:
        lines.extend(
            [
                f"  - hostname: {node['name']}",
                "    role: master",
                "    interfaces:",
            ]
        )
        for interface in node["interfaces"]:
            lines.extend(
                [
                    f"      - name: {interface['name']}",
                    f"        macAddress: \"{interface['macAddress']}\"",
                ]
            )
        lines.extend(
            [
                "    rootDeviceHints:",
                f"      serialNumber: \"{node['diskSerial']}\"",
                "    networkConfig:",
            ]
        )
        lines.extend(indent_block(node["networkYaml"], "      "))

    return "\n".join(lines) + "\n"


def render_guest_plan(request: dict, nodes: list[dict]) -> str:
    lines = [
        "apiVersion: cockpit-assistant-installer-local/v1alpha1",
        "kind: GuestPlan",
        "cluster:",
        f"  name: {request['clusterName']}",
        f"  baseDomain: {request['baseDomain']}",
        f"  topology: {request['topology']}",
        "host:",
        f"  storagePool: {request['storage']['storagePool']}",
        f"  primaryBridge: {request['network']['bridgeName']}",
        f"  secondaryBridge: {request['network'].get('secondaryBridgeName') or 'none'}",
        "controlPlane:",
        f"  vcpus: {request['compute']['nodeVcpus']}",
        f"  memoryMiB: {request['compute']['nodeMemoryMb']}",
        f"  rootDiskGiB: {request['storage']['diskSizeGb']}",
        f"  performanceDomain: {request['compute']['performanceDomain']}",
        "nodes:",
    ]
    for node in nodes:
        lines.extend(
            [
                f"  - name: {node['name']}",
                f"    role: {node['role']}",
                f"    ipAddress: {node['ipAddress']}",
                f"    primaryMacAddress: {node['macAddress']}",
                "    rootDisk:",
                f"      path: {node['diskPath']}",
                f"      format: {node['diskFormat']}",
                f"      serial: {node['diskSerial']}",
                "    interfaces:",
            ]
        )
        for interface in node["interfaces"]:
            lines.extend(
                [
                    f"      - name: {interface['name']}",
                    f"        bridge: {interface['bridge']}",
                    f"        macAddress: {interface['macAddress']}",
                ]
            )
    return "\n".join(lines) + "\n"


def render_static_network_configs(request: dict) -> str:
    lines = [
        "apiVersion: cockpit-openshift/v1alpha1",
        "kind: StaticNetworkConfigs",
        "hosts:",
    ]
    for host in request["hosts"]:
        lines.extend(
            [
                f"  - hostname: {host['name']}",
                f"    ipAddress: {host['ipAddress']}",
                "    networkConfig: |-",
            ]
        )
        lines.extend(indent_block(host["networkYaml"].rstrip(), "      "))
    return "\n".join(lines) + "\n"


def render_discovery_plan(request: dict, nodes: list[dict], paths: dict) -> str:
    lines = [
        "apiVersion: cockpit-openshift/v1alpha1",
        "kind: DiscoveryPlan",
        "cluster:",
        f"  name: {request['clusterName']}",
        f"  baseDomain: {request['baseDomain']}",
        f"  discoveryIso: {paths['hypervisorIso']}",
        f"  sshPublicKeySource: {request['secretInputs']['sshPublicKeySource']}",
        "hosts:",
    ]
    for node in nodes:
        lines.extend(
            [
                f"  - hostname: {node['name']}",
                f"    domain: {node['name']}.{request['clusterName']}.{request['baseDomain']}",
                f"    ipAddress: {node['ipAddress']}",
                "    attachments:",
            ]
        )
        for interface in node["interfaces"]:
            lines.extend(
                [
                    f"      - name: {interface['name']}",
                    f"        bridge: {interface['bridge']}",
                    f"        macAddress: {interface['macAddress']}",
                ]
            )
    return "\n".join(lines) + "\n"


def render_artifact_bundle(request: dict) -> dict:
    preview_request = preview_request_from_runtime(request)
    pool = preview_request["storage"]["pool"]
    nodes = build_nodes(preview_request, pool)
    paths = derive_request_paths(preview_request)
    install_config = render_install_config(preview_request, nodes)
    install_config_redacted = install_config.replace(
        preview_request["secretMaterial"]["pullSecret"].strip(),
        "<redacted>",
    )
    virt_install_plan = "\n\n".join(
        " ".join(build_virt_install_command(preview_request, node, paths["hypervisorIso"]))
        for node in nodes
    )
    return {
        "ok": True,
        "artifacts": [
            {"name": "install-config.yaml", "content": install_config_redacted, "contentType": "text/yaml"},
            {"name": "agent-config.yaml", "content": render_agent_config(preview_request, nodes), "contentType": "text/yaml"},
            {"name": "static-network-configs.yaml", "content": render_static_network_configs(preview_request), "contentType": "text/yaml"},
            {"name": "guest-plan.yaml", "content": render_guest_plan(preview_request, nodes), "contentType": "text/yaml"},
            {"name": "discovery-plan.yaml", "content": render_discovery_plan(preview_request, nodes, paths), "contentType": "text/yaml"},
            {"name": "virt-install-plan.txt", "content": virt_install_plan + "\n", "contentType": "text/plain"},
        ],
    }


def download_file(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url) as response, dest.open("wb") as handle:
        shutil.copyfileobj(response, handle)


def ensure_installer_binaries(request: dict, paths: dict) -> None:
    installer_binary = paths["installerBinary"]
    oc_binary = paths["ocBinary"]
    if installer_binary.exists() and oc_binary.exists():
        return

    log_step(f"Ensuring OpenShift installer binaries for {request['openshiftRelease']}")
    ensure_private_dir(paths["workDir"])
    ensure_private_dir(paths["downloadsDir"])
    ensure_private_dir(paths["binDir"])

    installer_archive = paths["downloadsDir"] / f"openshift-install-linux-{request['openshiftRelease']}.tar.gz"
    client_archive = paths["downloadsDir"] / f"openshift-client-linux-{request['openshiftRelease']}.tar.gz"

    if not installer_archive.exists():
        download_file(
            f"{OPENSHIFT_MIRROR_BASE_URL}/{request['openshiftRelease']}/{installer_archive.name}",
            installer_archive,
        )
    if not client_archive.exists():
        download_file(
            f"{OPENSHIFT_MIRROR_BASE_URL}/{request['openshiftRelease']}/{client_archive.name}",
            client_archive,
        )

    with tarfile.open(installer_archive, "r:gz") as archive:
        archive.extractall(paths["binDir"])
    with tarfile.open(client_archive, "r:gz") as archive:
        archive.extractall(paths["binDir"])

    installer_binary.chmod(0o755)
    oc_binary.chmod(0o755)


def ensure_pool_active(pool: dict) -> None:
    if pool["active"]:
        return
    run_logged(["virsh", "pool-start", pool["name"]], step=f"Starting storage pool {pool['name']}")


def ensure_dir_pool_context(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    if str(path) == str(LIBVIRT_MEDIA_DIR):
        return
    if shutil.which("semanage"):
        pattern = f"{path}(/.*)?"
        run("semanage", "fcontext", "-a", "-t", "virt_image_t", pattern, check=False)
        run("semanage", "fcontext", "-m", "-t", "virt_image_t", pattern, check=False)
    run("restorecon", "-RF", str(path), check=False)


def destroy_domain(domain: str) -> None:
    run("virsh", "destroy", domain, check=False)
    run("virsh", "undefine", domain, "--nvram", check=False)


def remove_disk(path: str) -> None:
    if path.startswith("/dev/"):
        proc = run("lvremove", "-fy", path, check=False)
        if proc.returncode != 0:
            message = proc.stderr.strip() or proc.stdout.strip() or f"Failed to remove logical volume {path}"
            raise RuntimeError(message)
    else:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError as exc:
            raise RuntimeError(f"Failed to remove disk {path}: {exc}") from exc


def cleanup_previous_install(request: dict, paths: dict) -> None:
    log_step("Cleaning previous cluster state")
    cluster_id = f"{request['clusterName']}.{request['baseDomain']}"
    for domain in cluster_domains(cluster_id):
        disk_paths = domain_disk_paths(domain)
        destroy_domain(domain)
        for disk_path in disk_paths:
            remove_disk(disk_path)
    paths["hypervisorIso"].unlink(missing_ok=True)
    if paths["workDir"].exists():
        shutil.rmtree(paths["workDir"])


def ensure_root_disks(pool: dict, nodes: list[dict]) -> None:
    pool_type = pool["type"]
    if pool_type == "dir":
        pool_path = Path(pool["targetPath"])
        ensure_dir_pool_context(pool_path)
        for node in nodes:
            disk_path = Path(node["diskPath"])
            if disk_path.exists():
                continue
            run_logged(
                [
                    "qemu-img",
                    "create",
                    "-f",
                    node["diskFormat"],
                    str(disk_path),
                    f"{node['diskSizeGb']}G",
                ],
                step=f"Creating root disk for {node['name']}",
            )
            run("chown", "root:qemu", str(disk_path), check=False)
            run("chmod", "0660", str(disk_path), check=False)
            run("restorecon", str(disk_path), check=False)
        return

    vg_name = pool["sourceName"] or Path(pool["targetPath"]).name
    for node in nodes:
        disk_path = Path(node["diskPath"])
        if disk_path.exists():
            continue
        run_logged(
            [
                "lvcreate",
                "-y",
                "-W",
                "y",
                "-L",
                f"{node['diskSizeGb']}G",
                "-n",
                disk_path.name,
                vg_name,
            ],
            step=f"Creating root disk for {node['name']}",
        )


def build_virt_install_command(request: dict, node: dict, iso_path: Path) -> list[str]:
    cmd = [
        "virt-install",
        "--name",
        f"{node['name']}.{request['clusterName']}.{request['baseDomain']}",
        "--osinfo",
        "name=rhel10.1",
        "--boot",
        "hd,cdrom",
        "--machine",
        "q35",
        "--memory",
        str(node["memoryMb"]),
        "--vcpus",
        str(node["vcpus"]),
        "--cpu",
        "host-passthrough",
        "--controller",
        "type=scsi,model=virtio-scsi",
        "--disk",
        (
            f"path={node['diskPath']},format={node['diskFormat']},bus=scsi,"
            f"cache=none,io=native,discard=unmap,rotation_rate=1,serial={node['diskSerial']}"
        ),
        "--disk",
        f"path={iso_path},device=cdrom,bus=scsi",
        "--rng",
        "builtin",
        "--import",
        "--graphics",
        "none",
        "--console",
        "pty,target_type=serial",
        "--autostart",
        "--noautoconsole",
        "--tpm",
        "none",
    ]

    for interface in node["interfaces"]:
        cmd.extend(
            [
                "--network",
                f"bridge={interface['bridge']},model=virtio,mac={interface['macAddress']}",
            ]
        )

    perf = request["compute"]["performanceDomain"]
    if perf in PERFORMANCE_DOMAINS and perf != "none":
        cmd.extend(["--cputune", f"shares={PERFORMANCE_DOMAINS[perf]['cpu_shares']}"])

    return cmd


def create_domains(request: dict, nodes: list[dict], paths: dict) -> None:
    for node in nodes:
        domain = f"{node['name']}.{request['clusterName']}.{request['baseDomain']}"
        existing = run("virsh", "dominfo", domain, check=False)
        if existing.returncode == 0:
            raise ValueError(f"Libvirt domain {domain} already exists. Use a clean rebuild first.")
        run_logged(
            build_virt_install_command(request, node, paths["hypervisorIso"]),
            step=f"Creating libvirt domain for {node['name']}",
        )


def verify_domain_boot_media(request: dict, nodes: list[dict], paths: dict) -> None:
    for node in nodes:
        domain = f"{node['name']}.{request['clusterName']}.{request['baseDomain']}"
        proc = run("virsh", "domblklist", domain, check=True)
        output = proc.stdout
        if node["diskPath"] not in output:
            raise ValueError(f"Root disk {node['diskPath']} was not attached to {domain}")
        if str(paths["hypervisorIso"]) not in output:
            raise ValueError(f"Agent ISO {paths['hypervisorIso']} was not attached to {domain}")


def render_install_artifacts(request: dict, nodes: list[dict], paths: dict) -> None:
    if paths["installDir"].exists():
        shutil.rmtree(paths["installDir"])
    ensure_private_dir(paths["workDir"])
    ensure_private_dir(paths["installDir"])
    write_private_file(paths["installDir"] / "install-config.yaml", render_install_config(request, nodes))
    write_private_file(paths["installDir"] / "agent-config.yaml", render_agent_config(request, nodes))


def generate_agent_iso(paths: dict) -> None:
    env = runtime_env()
    run_logged(
        [
            str(paths["installerBinary"]),
            "agent",
            "create",
            "image",
            "--dir",
            str(paths["installDir"]),
        ],
        cwd=paths["installDir"],
        env=env,
        step="Generating agent boot media",
    )
    if not paths["localIso"].exists():
        raise ValueError(f"Expected generated ISO at {paths['localIso']}")
    shutil.copy2(paths["localIso"], paths["hypervisorIso"])
    run("restorecon", str(paths["hypervisorIso"]), check=False)


def wait_for_installer(paths: dict, phase: str) -> None:
    env = runtime_env()
    run_logged(
        [
            str(paths["installerBinary"]),
            f"--dir={paths['installDir']}",
            "agent",
            "wait-for",
            phase,
            "--log-level=debug",
        ],
        env=env,
        step=f"Waiting for {phase.replace('-', ' ')}",
    )


def cdrom_targets(domain: str, media_path: Path) -> list[str]:
    proc = run("virsh", "domblklist", domain, "--details", check=True)
    targets: list[str] = []
    for line in proc.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[1] == "cdrom" and parts[3] in {str(media_path), "-"}:
            targets.append(parts[2])
    return targets


def detach_install_media(request: dict, nodes: list[dict], paths: dict) -> None:
    log_step("Detaching install media and resetting boot order")
    for node in nodes:
        domain = f"{node['name']}.{request['clusterName']}.{request['baseDomain']}"
        for target in cdrom_targets(domain, paths["hypervisorIso"]):
            run_logged(
                ["virsh", "change-media", domain, target, "--eject", "--config", "--live"],
                step=f"Ejecting install media from {domain}",
            )
        run_logged(["virt-xml", domain, "--edit", "--boot", "hd"], step=f"Resetting boot order for {domain}")


def validate_cluster(request: dict, nodes: list[dict], paths: dict) -> None:
    env = runtime_env()
    env["KUBECONFIG"] = str(paths["kubeconfig"])
    oc = str(paths["ocBinary"])

    cluster_version = json.loads(run_logged([oc, "get", "clusterversion", "-o", "json"], env=env, step="Validating cluster version").stdout)
    node_data = json.loads(run_logged([oc, "get", "nodes", "-o", "json"], env=env, step="Validating cluster nodes").stdout)
    operators = json.loads(run_logged([oc, "get", "clusteroperators", "-o", "json"], env=env, step="Validating cluster operators").stdout)

    cv_item = cluster_version["items"][0]
    conditions = {entry["type"]: entry["status"] for entry in cv_item["status"]["conditions"]}
    if conditions.get("Available") != "True" or conditions.get("Progressing") != "False":
        raise ValueError("ClusterVersion did not report Available=True and Progressing=False")

    observed_nodes = {item["metadata"]["name"]: item for item in node_data["items"]}
    if len(observed_nodes) != len(nodes):
        raise ValueError("The cluster did not report the expected number of nodes")
    for node in nodes:
        if node["name"] not in observed_nodes:
            raise ValueError(f"Expected node {node['name']} was not present in the cluster")
        ready = {
            cond["type"]: cond["status"]
            for cond in observed_nodes[node["name"]]["status"]["conditions"]
        }.get("Ready")
        if ready != "True":
            raise ValueError(f"Node {node['name']} did not report Ready=True")

    for operator in operators["items"]:
        conds = {entry["type"]: entry["status"] for entry in operator["status"]["conditions"]}
        if conds.get("Available") != "True" or conds.get("Degraded") == "True":
            raise ValueError(f"Cluster operator {operator['metadata']['name']} was not healthy")


def collect_install_access(request: dict, paths: dict) -> dict:
    console_url = f"https://console-openshift-console.apps.{request['clusterName']}.{request['baseDomain']}"
    password_file = paths["installDir"] / "auth" / "kubeadmin-password"
    access = {
        "consoleUrl": console_url,
        "kubeconfigPath": str(paths["kubeconfig"]),
        "kubeadminUsername": "kubeadmin",
        "kubeadminPassword": "",
    }
    if password_file.exists():
        access["kubeadminPassword"] = password_file.read_text(encoding="utf-8").strip()
    return access


def cluster_install_access(cluster_name: str, base_domain: str, work_dir: Path) -> dict:
    install_dir = work_dir / "generated" / "ocp"
    password_file = install_dir / "auth" / "kubeadmin-password"
    kubeconfig_path = install_dir / "auth" / "kubeconfig"
    access = {
        "consoleUrl": f"https://console-openshift-console.apps.{cluster_name}.{base_domain}",
        "kubeconfigPath": str(kubeconfig_path),
        "kubeadminUsername": "kubeadmin",
        "kubeadminPassword": "",
    }
    if password_file.exists():
        access["kubeadminPassword"] = password_file.read_text(encoding="utf-8").strip()
    return access


def cluster_domains(cluster_id: str) -> list[str]:
    suffix = f".{cluster_id}"
    return [name for name in virsh_domain_names() if name.endswith(suffix)]


def domain_disk_paths(domain: str) -> list[str]:
    proc = run("virsh", "domblklist", domain, "--details", check=False)
    if proc.returncode != 0:
        return []
    paths: list[str] = []
    for line in proc.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[1] == "disk" and parts[3] != "-":
            paths.append(parts[3])
    return paths


def cluster_oc_binary(work_dir: Path) -> Path | None:
    candidates = sorted(work_dir.glob("tools/*/bin/oc"))
    return candidates[-1] if candidates else None


def cluster_health(cluster_id: str, work_dir: Path) -> dict:
    kubeconfig = work_dir / "generated" / "ocp" / "auth" / "kubeconfig"
    oc = cluster_oc_binary(work_dir)
    result = {
        "apiReachable": False,
        "available": False,
        "readyNodes": 0,
        "totalNodes": 0,
        "message": "",
    }
    if not kubeconfig.exists() or oc is None:
        result["message"] = "No kubeconfig found"
        return result

    env = runtime_env()
    env["KUBECONFIG"] = str(kubeconfig)
    nodes_proc = run(str(oc), "get", "nodes", "-o", "json", check=False, env=env)
    if nodes_proc.returncode != 0:
        result["message"] = nodes_proc.stderr.strip() or nodes_proc.stdout.strip() or "Unable to query nodes"
        return result

    result["apiReachable"] = True
    node_data = json.loads(nodes_proc.stdout)
    result["totalNodes"] = len(node_data["items"])
    for item in node_data["items"]:
        ready = {
            cond["type"]: cond["status"]
            for cond in item["status"]["conditions"]
        }.get("Ready")
        if ready == "True":
            result["readyNodes"] += 1

    cv_proc = run(str(oc), "get", "clusterversion", "-o", "json", check=False, env=env)
    if cv_proc.returncode == 0:
        cv = json.loads(cv_proc.stdout)
        if cv.get("items"):
            conditions = {
                cond["type"]: cond["status"]
                for cond in cv["items"][0]["status"]["conditions"]
            }
            result["available"] = conditions.get("Available") == "True" and conditions.get("Progressing") == "False"
    return result


def discover_clusters() -> list[dict]:
    clusters: list[dict] = []
    if not WORK_ROOT.exists():
        return clusters

    for work_dir in sorted([path for path in WORK_ROOT.iterdir() if path.is_dir()]):
        cluster_id = work_dir.name
        try:
            cluster_name, base_domain = split_cluster_id(cluster_id)
        except ValueError:
            continue
        domains = cluster_domains(cluster_id)
        topology = "compact" if len(domains) == 3 else "sno" if len(domains) == 1 else "unknown"
        health = cluster_health(cluster_id, work_dir)
        console_url = f"https://console-openshift-console.apps.{cluster_name}.{base_domain}"
        metadata_path = cluster_metadata_path(work_dir)
        metadata = {
            "createdAt": dt.datetime.fromtimestamp(work_dir.stat().st_mtime, tz=dt.timezone.utc).isoformat(),
            "owner": "local-admin",
            "openshiftVersion": DEFAULT_VERSION,
            "openshiftRelease": DEFAULT_VERSION.split(" ", 1)[-1],
            "provider": "Local libvirt / KVM",
            "region": "Local KVM host",
            "channelGroup": channel_group(DEFAULT_VERSION.split(" ", 1)[-1]),
            "partnerIntegration": DEFAULT_PLATFORM_INTEGRATION,
            "nodeVcpus": 0,
            "memoryMb": 0,
            "operators": [],
        }
        if metadata_path.exists():
            try:
                metadata.update(json.loads(metadata_path.read_text(encoding="utf-8")))
            except Exception:
                pass
        clusters.append(
            {
                "clusterId": cluster_id,
                "clusterName": cluster_name,
                "baseDomain": base_domain,
                "topology": topology,
                "domains": domains,
                "nodeCount": len(domains),
                "consoleUrl": console_url,
                "kubeconfigPath": str(work_dir / "generated" / "ocp" / "auth" / "kubeconfig"),
                "health": health,
                "createdAt": metadata["createdAt"],
                "owner": metadata["owner"],
                "openshiftVersion": metadata["openshiftVersion"],
                "openshiftRelease": metadata["openshiftRelease"],
                "provider": metadata["provider"],
                "region": metadata["region"],
                "channelGroup": metadata["channelGroup"],
                "partnerIntegration": metadata["partnerIntegration"],
                "nodeVcpus": metadata["nodeVcpus"],
                "memoryMb": metadata["memoryMb"],
                "operators": metadata["operators"],
                "installAccess": cluster_install_access(cluster_name, base_domain, work_dir),
            }
        )
    return clusters


def handle_options() -> int:
    pools = query_storage_pools()
    bridges = query_bridges()
    return json_response(
        {
            "ok": True,
            "storagePools": pools,
            "bridges": bridges,
            "defaults": {
                "storagePool": choose_default_pool(pools),
                "bridgeName": choose_default_bridge(bridges),
                "pullSecretFile": DEFAULT_PULL_SECRET_PATH,
                "sshPublicKeyFile": DEFAULT_SSH_PUBLIC_KEY_PATH,
                "performanceDomain": DEFAULT_PERFORMANCE_DOMAIN,
            },
            "running": job_running(load_state()),
        }
    )


def handle_clusters() -> int:
    return json_response({"ok": True, "clusters": discover_clusters(), "running": job_running(load_state())})


def validate_payload(payload: dict) -> tuple[dict, list[str]]:
    errors: list[str] = []

    cluster_name = str(payload.get("clusterName", "")).strip()
    base_domain = str(payload.get("baseDomain", "")).strip()
    version_label = str(payload.get("openshiftVersion", DEFAULT_VERSION)).strip()
    cpu_architecture = str(payload.get("cpuArchitecture", "")).strip()
    topology = normalize_topology(int(payload.get("controlPlaneCount", 0)))
    hosts_network = str(payload.get("hostsNetworkConfiguration", "")).strip()
    platform_integration = str(payload.get("partnerIntegration", DEFAULT_PLATFORM_INTEGRATION)).strip() or DEFAULT_PLATFORM_INTEGRATION
    pull_secret_file = str(payload.get("pullSecretFile", "")).strip()
    ssh_public_key_file = str(payload.get("sshPublicKeyFile", "")).strip()
    pull_secret_value = str(payload.get("pullSecretValue", "")).strip()
    ssh_public_key_value = str(payload.get("sshPublicKeyValue", "")).strip()
    storage_pool_name = str((payload.get("storage", {}) or {}).get("storagePool", "")).strip()
    bridge_name = str(payload.get("bridgeName", "")).strip()
    secondary_bridge_name = str(payload.get("secondaryBridgeName", "")).strip()
    performance_domain = str(payload.get("performanceDomain", DEFAULT_PERFORMANCE_DOMAIN)).strip() or DEFAULT_PERFORMANCE_DOMAIN
    match = VERSION_PATTERN.match(version_label)

    validate_cluster_name(cluster_name, errors)
    if not base_domain:
        errors.append("Base domain")
    if cpu_architecture != SUPPORTED_ARCH:
        errors.append("CPU architecture must remain x86_64")
    if hosts_network != "static":
        errors.append("Hosts' network configuration must be Static IP, bridges, and bonds")
    if payload.get("disconnectedEnvironment"):
        errors.append("Disconnected installs are not wired yet")
    if payload.get("encryptionControlPlane") or payload.get("encryptionWorkers") or payload.get("encryptionArbiter"):
        errors.append("Disk encryption toggles are not wired yet")
    if performance_domain not in PERFORMANCE_DOMAINS:
        errors.append("Performance domain")
    if not match:
        errors.append("OpenShift version")

    compute = payload.get("compute", {}) or {}
    node_vcpus = int(compute.get("nodeVcpus", 0) or 0)
    node_memory_mb = int(compute.get("nodeMemoryMb", 0) or 0)
    if node_vcpus <= 0:
        errors.append("Control plane vCPU count")
    if node_memory_mb <= 0:
        errors.append("Control plane memory")

    storage = payload.get("storage", {}) or {}
    disk_size_gb = int(storage.get("diskSizeGb", 0) or 0)
    if disk_size_gb <= 0:
        errors.append("Root disk size")
    if not storage_pool_name:
        errors.append("Storage pool")

    network = payload.get("network", {}) or {}
    machine_cidr = str(network.get("machineCidr", "")).strip()
    machine_gateway = str(network.get("machineGateway", "")).strip()
    dns_servers = [str(entry).strip() for entry in network.get("dnsServers", []) if str(entry).strip()]
    api_vip = str(network.get("apiVip", "")).strip()
    ingress_vip = str(network.get("ingressVip", "")).strip()
    primary_interface_name = str(network.get("primaryInterfaceName", GUEST_PRIMARY_INTERFACE)).strip() or GUEST_PRIMARY_INTERFACE
    secondary_interface_name = str(network.get("secondaryInterfaceName", "eth1")).strip() or "eth1"
    private_vlan_id = str(network.get("privateVlanId", "")).strip()

    if not machine_cidr:
        errors.append("Machine network CIDR")
    else:
        try:
            ipaddress.ip_network(machine_cidr, strict=False)
        except ValueError:
            errors.append("Machine network CIDR")
    if machine_gateway:
        validate_ip(machine_gateway, "Machine gateway", errors)
    if dns_servers:
        for idx, server in enumerate(dns_servers, start=1):
            validate_ip(server, f"DNS server {idx}", errors)

    raw_hosts = payload.get("hosts", []) or []
    expected_node_count = 1 if topology == "sno" else 3
    if len(raw_hosts) != expected_node_count:
        errors.append(f"Exactly {expected_node_count} host definitions are required")

    hosts: list[dict] = []
    node_ips: list[str] = []
    for idx in range(expected_node_count):
        host_payload = raw_hosts[idx] if idx < len(raw_hosts) else {}
        host_name = str(host_payload.get("name", "")).strip()
        host_mac = str(host_payload.get("macAddress", "")).strip().lower()
        host_ip = str(host_payload.get("ipAddress", "")).strip()
        host_yaml = str(host_payload.get("networkYaml", "")).rstrip()

        if not host_name:
            errors.append(f"Host {idx + 1} name")
        elif not CLUSTER_NAME_PATTERN.match(host_name):
            errors.append(f"Host {idx + 1} name must contain only lowercase letters, numbers, and hyphens")
        if not host_mac:
            errors.append(f"Host {idx + 1} MAC address")
        else:
            validate_mac(host_mac, f"Host {idx + 1} MAC address", errors)
        if not host_ip:
            errors.append(f"Host {idx + 1} private IP")
        else:
            validate_ip(host_ip, f"Host {idx + 1} private IP", errors)
        if not host_yaml:
            errors.append(f"Host {idx + 1} network YAML")

        hosts.append(
            {
                "name": host_name,
                "role": str(host_payload.get("role", "control-plane")).strip() or "control-plane",
                "macAddress": host_mac,
                "ipAddress": host_ip,
                "networkYaml": host_yaml,
            }
        )
        if host_ip:
            node_ips.append(host_ip)

    if topology == "compact":
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

    if not bridge_name:
        errors.append("Bridge interface")
    else:
        bridges = query_bridges()
        if bridge_name not in bridges:
            errors.append("Bridge interface")
        if secondary_bridge_name and secondary_bridge_name not in bridges:
            errors.append("Secondary bridge")
        if secondary_bridge_name and secondary_bridge_name == bridge_name:
            errors.append("Secondary bridge must differ from primary bridge")

    if not pull_secret_value:
        if not pull_secret_file or not Path(pull_secret_file).exists():
            errors.append("Pull secret")
    else:
        try:
            json.loads(pull_secret_value)
        except json.JSONDecodeError:
            errors.append("Pull secret")

    if not ssh_public_key_value:
        if not ssh_public_key_file or not Path(ssh_public_key_file).exists():
            errors.append("SSH public key")

    try:
        pool = determine_pool(storage_pool_name)
    except ValueError as exc:
        errors.append(str(exc))
        pool = None
    else:
        if not pool["active"]:
            # allowed, job will start it
            pass

    required_binaries = ["systemd-run", "virsh", "virt-install", "virt-xml"]
    if pool and pool["type"] == "dir":
        required_binaries.append("qemu-img")
    if pool and pool["type"] == "logical":
        required_binaries.extend(["lvcreate", "lvremove"])

    for binary in required_binaries:
        try:
            run(binary, "--version", check=True)
        except Exception:
            if binary in {"virsh", "virt-install", "virt-xml"}:
                try:
                    run(binary, "--help", check=True)
                except Exception:
                    errors.append(binary)
            else:
                errors.append(binary)

    normalized = {
        "clusterName": cluster_name,
        "baseDomain": base_domain,
        "cpuArchitecture": cpu_architecture,
        "openshiftVersion": version_label,
        "openshiftRelease": match.group("version") if match else "",
        "topology": topology,
        "platformType": "none" if topology == "sno" else "baremetal",
        "partnerIntegration": platform_integration,
        "operators": [str(entry).strip() for entry in payload.get("operators", []) if str(entry).strip()],
        "hostsNetworkConfiguration": hosts_network,
        "network": {
            "bridgeName": bridge_name,
            "secondaryBridgeName": secondary_bridge_name,
            "machineCidr": machine_cidr,
            "machineGateway": machine_gateway,
            "dnsServers": dns_servers,
            "nodeIps": node_ips,
            "apiVip": api_vip,
            "ingressVip": ingress_vip,
            "primaryInterfaceName": primary_interface_name,
            "secondaryInterfaceName": secondary_interface_name,
            "privateVlanId": private_vlan_id,
        },
        "compute": {
            "nodeVcpus": node_vcpus,
            "nodeMemoryMb": node_memory_mb,
            "performanceDomain": performance_domain,
        },
        "storage": {
            "storagePool": storage_pool_name,
            "diskSizeGb": disk_size_gb,
        },
        "hosts": hosts,
        "secretInputs": {
            "pullSecretSource": "inline" if pull_secret_value else "file",
            "pullSecretFile": pull_secret_file,
            "sshPublicKeySource": "inline" if ssh_public_key_value else "file",
            "sshPublicKeyFile": ssh_public_key_file,
        },
        "secretMaterial": {
            "pullSecret": pull_secret_value if pull_secret_value else read_optional_file(pull_secret_file),
            "sshPublicKey": ssh_public_key_value if ssh_public_key_value else read_optional_file(ssh_public_key_file),
        },
    }
    if pool:
        normalized["storage"]["pool"] = pool

    return normalized, errors


def materialize_secret_files(request: dict) -> dict:
    ensure_runtime_dirs()
    SECRET_DIR.mkdir(parents=True, exist_ok=True)
    pull_secret_path = SECRET_DIR / "pull-secret.json"
    ssh_public_key_path = SECRET_DIR / "id_ed25519.pub"
    pull_secret_path.write_text(request["secretMaterial"]["pullSecret"].strip() + "\n", encoding="utf-8")
    ssh_public_key_path.write_text(request["secretMaterial"]["sshPublicKey"].strip() + "\n", encoding="utf-8")
    pull_secret_path.chmod(0o600)
    ssh_public_key_path.chmod(0o600)

    materialized = dict(request)
    materialized["secretFiles"] = {
        "pullSecretFile": str(pull_secret_path),
        "sshPublicKeyFile": str(ssh_public_key_path),
    }
    del materialized["secretMaterial"]
    return materialized


def handle_preflight(payload_b64: str) -> int:
    try:
        request, errors = validate_payload(parse_payload(payload_b64))
    except ValueError as exc:
        return json_response({"ok": False, "errors": [str(exc)]}, exit_code=0)

    return json_response(
        {
            "ok": not errors,
            "errors": errors,
            "request": public_request_view(request),
            "running": job_running(load_state()),
        }
    )


def handle_artifacts(payload_b64: str | None, current: bool) -> int:
    if current:
        if not REQUEST_FILE.exists():
            return json_response({"ok": False, "errors": ["No current deployment request is recorded"]}, exit_code=0)
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


def handle_start(payload_b64: str, mode: str) -> int:
    try:
        request, errors = validate_payload(parse_payload(payload_b64))
    except ValueError as exc:
        return json_response({"ok": False, "errors": [str(exc)]}, exit_code=0)

    existing_state = load_state()
    if job_running(existing_state):
        return json_response({"ok": False, "errors": ["A deployment is already running"]})
    if errors:
        return json_response({"ok": False, "errors": errors})

    clear_runtime_state()
    ensure_runtime_dirs()
    request["createdAt"] = current_timestamp()
    request["owner"] = discover_owner()
    request["provider"] = "Local libvirt / KVM"
    request["region"] = "Local KVM host"
    request["channelGroup"] = channel_group(request["openshiftRelease"])
    request = materialize_secret_files(request)
    paths = derive_request_paths(request)
    write_private_file(LOG_FILE, "")
    write_private_file(REQUEST_FILE, json.dumps(request, indent=2, sort_keys=True))
    write_private_file(cluster_metadata_path(paths["workDir"]), json.dumps(cluster_metadata_view(request), indent=2, sort_keys=True))

    unit_name = f"cockpit-openshift-{dt.datetime.now():%Y%m%d%H%M%S}"
    state = record_request_summary(request, mode, unit_name)
    state["status"] = "starting"
    save_state(state)

    proc = run(
        "systemd-run",
        "--unit",
        unit_name,
        "--description",
        "Cockpit OpenShift",
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
        return json_response({"ok": False, "errors": [state["error"]]})

    state["status"] = "running"
    save_state(state)
    return json_response({"ok": True, "unitName": unit_name, "request": public_request_view(request)})


def run_install_job(mode: str, unit_name: str) -> int:
    request = json.loads(REQUEST_FILE.read_text(encoding="utf-8"))
    paths = derive_request_paths(request)
    pool = request["storage"]["pool"]
    nodes = build_nodes(request, pool)
    log_step(f"Starting {mode} for {request['topology']} cluster {request['clusterName']}.{request['baseDomain']}")
    log_line(f"[INFO] HOME={RUNTIME_HOME_DIR}")
    log_line(f"[INFO] XDG_CACHE_HOME={RUNTIME_CACHE_DIR}")

    rc = 0
    try:
        if mode == "redeploy":
            cleanup_previous_install(request, paths)

        ensure_installer_binaries(request, paths)
        ensure_pool_active(pool)
        render_install_artifacts(request, nodes, paths)
        generate_agent_iso(paths)
        ensure_root_disks(pool, nodes)
        create_domains(request, nodes, paths)
        verify_domain_boot_media(request, nodes, paths)
        wait_for_installer(paths, "bootstrap-complete")
        wait_for_installer(paths, "install-complete")
        detach_install_media(request, nodes, paths)
        validate_cluster(request, nodes, paths)
        state = load_state()
        state["installAccess"] = collect_install_access(request, paths)
        save_state(state)
        log_step("Installation completed successfully")
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


def run_destroy_job(unit_name: str, cluster_id: str) -> int:
    clusters = {cluster["clusterId"]: cluster for cluster in discover_clusters()}
    cluster = clusters.get(cluster_id)
    if not cluster:
        log_line(f"[ERROR] Cluster {cluster_id} was not found")
        state = load_state()
        state.update(
            {
                "unitName": unit_name,
                "status": "failed",
                "endedAt": current_timestamp(),
                "returnCode": 1,
                "error": f"Cluster {cluster_id} was not found",
            }
        )
        save_state(state)
        return 1

    cluster_name = cluster["clusterName"]
    base_domain = cluster["baseDomain"]
    work_dir = WORK_ROOT / cluster_id
    media_path = LIBVIRT_MEDIA_DIR / f"{cluster_name}-agent.{SUPPORTED_ARCH}.iso"
    log_step(f"Starting destroy for cluster {cluster_id}")

    rc = 0
    try:
        for domain in cluster["domains"]:
            disk_paths = domain_disk_paths(domain)
            log_step(f"Destroying domain {domain}")
            destroy_domain(domain)
            for disk_path in disk_paths:
                log_step(f"Removing disk {disk_path}")
                remove_disk(disk_path)
        if media_path.exists():
            log_step(f"Removing install media {media_path.name}")
            media_path.unlink(missing_ok=True)
        if work_dir.exists():
            log_step(f"Removing work directory {work_dir}")
            shutil.rmtree(work_dir)
        log_step("Cluster destroy completed successfully")
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


def handle_run_job(mode: str, unit_name: str, cluster_id: str | None) -> int:
    ensure_runtime_dirs()
    if mode == "destroy":
        if not cluster_id:
            return 1
        return run_destroy_job(unit_name, cluster_id)
    return run_install_job(mode, unit_name)


def handle_status() -> int:
    state = load_state()
    unit_name = state.get("unitName", "")
    service_status = unit_status(unit_name)
    log_lines = tail_log()
    request = None
    if REQUEST_FILE.exists():
        try:
            request = public_request_view(json.loads(REQUEST_FILE.read_text(encoding="utf-8")))
        except Exception:
            request = None
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
        return json_response({"ok": False, "errors": ["No active deployment is recorded"]})
    run("systemctl", "stop", unit_name, check=False)
    state["status"] = "canceled"
    state["endedAt"] = current_timestamp()
    save_state(state)
    return json_response({"ok": True, "unitName": unit_name})


def handle_destroy(cluster_id: str) -> int:
    clusters = {cluster["clusterId"]: cluster for cluster in discover_clusters()}
    if cluster_id not in clusters:
        return json_response({"ok": False, "errors": [f"Cluster {cluster_id} was not found"]}, exit_code=0)

    state = load_state()
    if job_running(state):
        return json_response({"ok": False, "errors": ["A deployment is already running"]}, exit_code=0)

    cluster = clusters[cluster_id]
    clear_runtime_state()
    ensure_runtime_dirs()
    write_private_file(LOG_FILE, "")
    unit_name = f"cockpit-openshift-destroy-{dt.datetime.now():%Y%m%d%H%M%S}"
    state = {
        "schema": STATE_SCHEMA,
        "clusterName": cluster["clusterName"],
        "baseDomain": cluster["baseDomain"],
        "topology": cluster["topology"],
        "mode": "destroy",
        "unitName": unit_name,
        "status": "starting",
        "startedAt": current_timestamp(),
        "clusterId": cluster_id,
    }
    save_state(state)

    proc = run(
        "systemd-run",
        "--unit",
        unit_name,
        "--description",
        "Cockpit OpenShift Destroy",
        "python3",
        str(HELPER_PATH),
        "run-job",
        "--mode",
        "destroy",
        "--unit-name",
        unit_name,
        "--cluster-id",
        cluster_id,
        check=False,
    )
    if proc.returncode != 0:
        state["status"] = "failed"
        state["endedAt"] = current_timestamp()
        state["error"] = proc.stderr.strip() or proc.stdout.strip() or "Failed to start destroy job"
        save_state(state)
        return json_response({"ok": False, "errors": [state["error"]]})

    state["status"] = "running"
    save_state(state)
    return json_response({"ok": True, "clusterId": cluster_id, "unitName": unit_name})


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
    start.add_argument("--mode", choices=["deploy", "redeploy"], required=True)

    run_job = subparsers.add_parser("run-job")
    run_job.add_argument("--mode", choices=["deploy", "redeploy", "destroy"], required=True)
    run_job.add_argument("--unit-name", required=True)
    run_job.add_argument("--cluster-id")

    subparsers.add_parser("options")
    subparsers.add_parser("clusters")
    subparsers.add_parser("status")
    subparsers.add_parser("cancel")
    destroy = subparsers.add_parser("destroy")
    destroy.add_argument("--cluster-id", required=True)

    args = parser.parse_args()
    try:
        if args.command == "options":
            return handle_options()
        if args.command == "clusters":
            return handle_clusters()
        if args.command == "preflight":
            return handle_preflight(args.payload_b64)
        if args.command == "artifacts":
            return handle_artifacts(args.payload_b64, args.current)
        if args.command == "start":
            return handle_start(args.payload_b64, args.mode)
        if args.command == "run-job":
            return handle_run_job(args.mode, args.unit_name, args.cluster_id)
        if args.command == "status":
            return handle_status()
        if args.command == "cancel":
            return handle_cancel()
        if args.command == "destroy":
            return handle_destroy(args.cluster_id)
    except Exception as exc:  # pragma: no cover
        return json_response({"ok": False, "errors": [str(exc)]}, exit_code=1)
    return 1


if __name__ == "__main__":
    sys.exit(main())
