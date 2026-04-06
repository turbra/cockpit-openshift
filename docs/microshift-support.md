# MicroShift Support Architecture

This branch adds MicroShift as a separate installer target inside the Cockpit
plugin. It does not reuse the OpenShift cluster deployment path.

## Authoritative Sources

- Red Hat Build of MicroShift 4.21 installation guide:
  https://docs.redhat.com/en/documentation/red_hat_build_of_microshift/4.21/html-single/getting_ready_to_install_microshift/index
- Upstream MicroShift implementation:
  https://github.com/openshift/microshift
- Community MicroShift mirror:
  https://github.com/microshift-io/microshift

The primary reference is the Red Hat installation guide plus the upstream
`openshift/microshift` repository. The community mirror was reviewed for
context, not as the governing implementation source.

## Architecture Approach

MicroShift is implemented as a dedicated host-based workflow:

- UI entrypoint: `src/cockpit-openshift/microshift.html`
- UI controller: `src/cockpit-openshift/microshift.js`
- Backend helper: `src/cockpit-openshift/microshift_backend.py`

This is an intentional separation from the existing OpenShift cluster flow,
because the documented MicroShift lifecycle is materially different:

- existing RHEL host
- RPM installation
- `/etc/microshift/config.yaml`
- remote service start and validation
- kubeconfig retrieval from `/var/lib/microshift/resources/kubeadmin/...`

The OpenShift assisted installer flow remains focused on multi-node KVM-backed
cluster deployment and libvirt artifact generation.

## Mapping to the Reference Model

The implementation aligns to the documented Red Hat MicroShift install model by:

- collecting target host SSH and sudo access details instead of cluster-host VM definitions
- validating RHEL version, architecture, SSH, sudo, and package availability before install
- rendering a MicroShift `config.yaml` from supported fields:
  - `dns.baseDomain`
  - `node.hostnameOverride`
  - `node.nodeIP`
  - `apiServer.subjectAltNames`
  - `network.clusterNetwork`
  - `network.serviceNetwork`
  - `network.serviceNodePortRange`
  - `debugging.logLevel`
- optionally configuring `firewalld` using the documented trusted sources and public ports
- installing `microshift` and `openshift-clients` through `dnf`
- writing:
  - `/etc/crio/openshift-pull-secret`
  - `/etc/microshift/config.yaml`
- enabling and starting `microshift.service`
- validating node readiness and pod state with `oc`
- copying the generated kubeconfig back to the Cockpit host

## Prerequisites and Deployment Flow

Expected prerequisites:

- Cockpit host can reach the target host with SSH key auth
- SSH user has `sudo -n`
- target host is RHEL 9 or RHEL 10
- target host repositories already provide:
  - `microshift`
  - `openshift-clients`
- operator supplies a valid pull secret

Deployment flow:

1. Operator selects `Install MicroShift` from the main landing page.
2. UI collects host connection details and MicroShift configuration inputs.
3. Review step runs backend preflight validation over SSH.
4. Backend uploads rendered artifacts and starts the RPM-based install flow.
5. Backend validates readiness and stores access details for the completed deployment.

## Known Gaps and Intentional Limits

- This implementation does not automate subscription registration or repository enablement.
  The target host must already be prepared for package installation.
- It does not attempt to model MicroShift as a multi-node OpenShift cluster.
  That is intentional and aligns with the documented host-based install flow.
- It does not currently maintain a dedicated MicroShift deployment inventory on the main cluster list page.
  The initial scope is a separate install path with runtime status and artifact review.
