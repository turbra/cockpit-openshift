---
title: Build Validation
description: Commands used to validate package and documentation changes.
---

# Build Validation

Use the checks that match the area you changed.

## RPM Build

```bash
sudo dnf install -y rpm-build
./build-rpm.sh
```

Expected output:

```text
rpmbuild/RPMS/noarch/cockpit-openshift-*.noarch.rpm
rpmbuild/SRPMS/cockpit-openshift-*.src.rpm
```

## Docs Build

```bash
cd website
npm ci
npm run build
```

## GitHub Pages Path Check

After a docs build, generated links should work under `/cockpit-openshift/`:

```bash
cd website
rg --pcre2 -n 'href="/(?!cockpit-openshift|/)|src="/(?!cockpit-openshift|/)' build
```

No matches should appear for internal site routes or assets.
