// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'index',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/install',
        'getting-started/first-run',
      ],
    },
    {
      type: 'category',
      label: 'Concepts',
      collapsed: false,
      items: [
        'concepts/capabilities',
        'concepts/runtime-model',
      ],
    },
    {
      type: 'category',
      label: 'Workflows',
      collapsed: false,
      items: [
        'workflows/practical-use-cases',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: [
        'reference/index',
        'reference/source-install',
        'reference/rpm-packaging',
        'reference/runtime-files',
        'reference/source-layout',
      ],
    },
    {
      type: 'category',
      label: 'Project',
      collapsed: false,
      items: [
        'project/documentation-map',
      ],
    },
  ],
};

module.exports = sidebars;
