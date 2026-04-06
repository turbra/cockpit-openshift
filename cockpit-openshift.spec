Name:           cockpit-openshift
Version:        0.1.0
Release:        1%{?dist}
Summary:        Cockpit plugin for local OpenShift installation

License:        GPL-3.0-or-later
URL:            https://github.com/turbra/cockpit-openshift
Source0:        %{name}-%{version}.tar.gz

BuildArch:      noarch

Requires:       cockpit-system
Requires:       cockpit-bridge

%description
Cockpit OpenShift is a Cockpit plugin prototype for a guided
OpenShift installation workflow on a local KVM host.

The current release provides:
- a wizard-style installer UI
- a privileged backend helper that owns the local install workflow
- deploy and clean-rebuild actions
- job status polling and recent log output

%prep
%autosetup

%build
# Nothing to build - pure HTML/JS/CSS plugin

%install
mkdir -p %{buildroot}%{_datadir}/cockpit/cockpit-openshift
install -m 0644 src/cockpit-openshift/manifest.json %{buildroot}%{_datadir}/cockpit/cockpit-openshift/
install -m 0644 src/cockpit-openshift/index.html %{buildroot}%{_datadir}/cockpit/cockpit-openshift/
install -m 0644 src/cockpit-openshift/create.html %{buildroot}%{_datadir}/cockpit/cockpit-openshift/
install -m 0644 src/cockpit-openshift/overview.html %{buildroot}%{_datadir}/cockpit/cockpit-openshift/
install -m 0644 src/cockpit-openshift/cockpit-openshift.js %{buildroot}%{_datadir}/cockpit/cockpit-openshift/
install -m 0644 src/cockpit-openshift/cluster-list.js %{buildroot}%{_datadir}/cockpit/cockpit-openshift/
install -m 0644 src/cockpit-openshift/cluster-overview.js %{buildroot}%{_datadir}/cockpit/cockpit-openshift/
install -m 0644 src/cockpit-openshift/cockpit-openshift.css %{buildroot}%{_datadir}/cockpit/cockpit-openshift/
install -m 0755 src/cockpit-openshift/installer_backend.py %{buildroot}%{_datadir}/cockpit/cockpit-openshift/
install -m 0644 README.md %{buildroot}%{_datadir}/cockpit/cockpit-openshift/

%files
%license LICENSE
%{_datadir}/cockpit/cockpit-openshift/
