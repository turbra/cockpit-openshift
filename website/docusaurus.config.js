// @ts-check

const lightCodeTheme = require('prism-react-renderer').themes.github;
const darkCodeTheme = require('prism-react-renderer').themes.dracula;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Cockpit OpenShift',
  tagline: 'Cockpit-hosted local OpenShift installer for one KVM/libvirt host.',

  url: 'https://turbra.github.io',
  baseUrl: '/cockpit-openshift/',
  organizationName: 'turbra',
  projectName: 'cockpit-openshift',
  trailingSlash: true,

  onBrokenLinks: 'throw',
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
      navbar: {
        title: 'Cockpit OpenShift',
        items: [
          {to: '/', label: 'Docs', position: 'left'},
          {to: '/getting-started/install', label: 'Install', position: 'left'},
          {to: '/workflows/practical-use-cases', label: 'Workflows', position: 'left'},
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
              {label: 'Getting Started', to: '/getting-started/install'},
              {label: 'Capabilities', to: '/concepts/capabilities'},
              {label: 'Reference', to: '/reference/'},
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
