Name:           cockpit-assisted-installer-local
Version:        0.1.0
Release:        1%{?dist}
Summary:        Cockpit plugin prototype for local OpenShift installation

License:        GPL-3.0-or-later
URL:            https://github.com/turbra/cockpit-assisted-installer-local
Source0:        %{name}-%{version}.tar.gz

BuildArch:      noarch

Requires:       cockpit-system
Requires:       cockpit-bridge

%description
Cockpit Assisted Installer Local is a Cockpit plugin prototype for a guided
OpenShift installation workflow on a local KVM host.

The current release provides:
- a wizard-style installer shell
- first-page cluster details form state and validation
- Cockpit-native static plugin packaging

It does not perform deployment actions yet.

%prep
%autosetup

%build
# Nothing to build - pure HTML/JS/CSS plugin

%install
mkdir -p %{buildroot}%{_datadir}/cockpit/cockpit-assisted-installer-local
install -m 0644 manifest.json %{buildroot}%{_datadir}/cockpit/cockpit-assisted-installer-local/
install -m 0644 index.html %{buildroot}%{_datadir}/cockpit/cockpit-assisted-installer-local/
install -m 0644 cockpit-assisted-installer-local.js %{buildroot}%{_datadir}/cockpit/cockpit-assisted-installer-local/
install -m 0644 cockpit-assisted-installer-local.css %{buildroot}%{_datadir}/cockpit/cockpit-assisted-installer-local/
install -m 0644 README.md %{buildroot}%{_datadir}/cockpit/cockpit-assisted-installer-local/

%files
%{_datadir}/cockpit/cockpit-assisted-installer-local/

