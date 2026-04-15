#!/bin/bash
set -euo pipefail

SPEC_NAME="cockpit-openshift"
VERSION="0.1.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_ROOT="${SCRIPT_DIR}/rpmbuild"
PLUGIN_SRC_DIR="${SCRIPT_DIR}/src/cockpit-openshift"

echo "==> Cleaning previous build artifacts"
rm -rf "${BUILD_ROOT}"
mkdir -p "${BUILD_ROOT}"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

echo "==> Creating source tarball"
TARBALL_DIR="${SPEC_NAME}-${VERSION}"
WORK="$(mktemp -d)"
mkdir -p "${WORK}/${TARBALL_DIR}"
mkdir -p "${WORK}/${TARBALL_DIR}/src/cockpit-openshift"
cp "${SCRIPT_DIR}"/{README.md,LICENSE} "${WORK}/${TARBALL_DIR}/"
cp "${PLUGIN_SRC_DIR}"/{manifest.json,index.html,create.html,overview.html,cockpit-openshift.js,cluster-list.js,cluster-overview.js,cockpit-openshift.css,installer_backend.py} \
   "${WORK}/${TARBALL_DIR}/src/cockpit-openshift/"
tar czf "${BUILD_ROOT}/SOURCES/${SPEC_NAME}-${VERSION}.tar.gz" -C "${WORK}" "${TARBALL_DIR}"
rm -rf "${WORK}"

echo "==> Copying spec file"
cp "${SCRIPT_DIR}/${SPEC_NAME}.spec" "${BUILD_ROOT}/SPECS/"

echo "==> Building RPM"
rpmbuild \
    --define "_topdir ${BUILD_ROOT}" \
    -ba "${BUILD_ROOT}/SPECS/${SPEC_NAME}.spec"

echo ""
echo "==> Build complete"
echo "RPMs:"
find "${BUILD_ROOT}/RPMS" -name "*.rpm" -print
echo "SRPMs:"
find "${BUILD_ROOT}/SRPMS" -name "*.rpm" -print
