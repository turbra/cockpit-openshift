// @ts-check

const lightCodeTheme = require('prism-react-renderer').themes.github;
const darkCodeTheme = require('prism-react-renderer').themes.dracula;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Cockpit OpenShift',
  tagline: 'Cockpit-hosted local OpenShift installer for one KVM/libvirt host.',
  favicon: 'img/logo.svg',

  url: 'https://turbra.github.io',
  baseUrl: '/cockpit-openshift/',
  organizationName: 'turbra',
  projectName: 'cockpit-openshift',
  trailingSlash: true,

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://github.com/turbra/cockpit-openshift/edit/main/website/',
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/dashboard-v2.png',
      metadata: [
        {
          name: 'description',
          content:
            'Documentation for Cockpit OpenShift, a Cockpit-hosted local OpenShift installer for one KVM/libvirt host.',
        },
      ],
      colorMode: {
        defaultMode: 'light',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Cockpit OpenShift',
        logo: {
          alt: 'Cockpit OpenShift',
          src: 'img/logo.svg',
        },
        items: [
          {to: '/', label: 'Docs', position: 'left'},
          {to: '/getting-started/install/', label: 'Getting Started', position: 'left'},
          {to: '/examples/', label: 'Examples', position: 'left'},
          {to: '/reference/', label: 'Reference', position: 'left'},
          {
            href: 'https://github.com/turbra/cockpit-openshift',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'light',
        links: [
          {
            title: 'Docs',
            items: [
              {label: 'Getting Started', to: '/getting-started/install/'},
              {label: 'Examples', to: '/examples/'},
              {label: 'Capabilities', to: '/concepts/capabilities/'},
              {label: 'Reference', to: '/reference/'},
              {label: 'Build Validation', to: '/project/build-validation/'},
            ],
          },
          {
            title: 'Project',
            items: [
              {label: 'Repository', href: 'https://github.com/turbra/cockpit-openshift'},
              {label: 'Issues', href: 'https://github.com/turbra/cockpit-openshift/issues'},
              {label: 'License', href: 'https://github.com/turbra/cockpit-openshift/blob/main/LICENSE'},
            ],
          },
        ],
        copyright: `Copyright ${new Date().getFullYear()} Cockpit OpenShift contributors.`,
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
        additionalLanguages: ['bash', 'json', 'yaml', 'powershell', 'python'],
      },
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 3,
      },
    }),
};

module.exports = config;
