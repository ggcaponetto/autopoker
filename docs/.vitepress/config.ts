import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(
  defineConfig({
    title: 'autopoker',
    description:
      'Screen-automation robot: pixel rules or an LLM decide what to click, from live screenshots.',
    // '/' locally; the GitHub Pages workflow sets DOCS_BASE=/autopoker/.
    base: process.env.DOCS_BASE ?? '/',
    lastUpdated: true,
    // Keep internal dead-link detection (it runs in `npm run check`); only skip the
    // localhost URLs the guide legitimately references (the daemon and UI ports).
    ignoreDeadLinks: 'localhostLinks',
    vite: {
      // The UI dev server owns 5173.
      server: { port: 5174 },
    },
    themeConfig: {
      nav: [
        { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
        { text: 'Development', link: '/dev/', activeMatch: '/dev/' },
      ],
      sidebar: {
        '/guide/': [
          {
            text: 'User guide',
            items: [
              { text: 'What is autopoker?', link: '/guide/' },
              { text: 'Getting started', link: '/guide/getting-started' },
              { text: 'The UI', link: '/guide/ui' },
              { text: 'Profiles & regions', link: '/guide/regions' },
              { text: 'Manual mode', link: '/guide/manual-mode' },
              { text: 'LLM mode', link: '/guide/llm-mode' },
              { text: 'Model providers', link: '/guide/providers' },
              { text: 'Writing strategies', link: '/guide/strategies' },
              { text: 'Safety', link: '/guide/safety' },
              { text: 'Troubleshooting', link: '/guide/troubleshooting' },
            ],
          },
        ],
        '/dev/': [
          {
            text: 'Developer guide',
            items: [
              { text: 'Architecture', link: '/dev/' },
              { text: 'The engine', link: '/dev/engine' },
              { text: 'The LLM pipeline', link: '/dev/llm' },
              { text: 'WebSocket protocol', link: '/dev/protocol' },
              { text: 'Storage & data', link: '/dev/storage' },
              { text: 'Extending autopoker', link: '/dev/extending' },
              { text: 'Development workflow', link: '/dev/workflow' },
            ],
          },
        ],
      },
      socialLinks: [{ icon: 'github', link: 'https://github.com/ggcaponetto/autopoker' }],
      editLink: {
        pattern: 'https://github.com/ggcaponetto/autopoker/edit/main/docs/:path',
        text: 'Edit this page on GitHub',
      },
      search: { provider: 'local' },
      outline: [2, 3],
      footer: {
        message: 'Dry-run is the default. Escape halts the engine.',
      },
    },
  }),
);
