import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/streamix/',
  title: 'streamix',
  description: 'Reactive library documentation',
  mpa: true,

  cleanUrls: true,

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Streamix v2', link: 'https://epikodelabs.github.io/streamix-v2' },
      { text: 'Pricing', link: '/PRICING' },
      { text: 'Changelog', link: '/CHANGELOG' },
      { text: 'API Reference', link: '/api/' },
      {
        text: 'Legal',
        items: [
          { text: 'Terms of Service', link: '/TERMS-OF-SERVICE' },
          { text: 'Privacy Policy', link: '/PRIVACY-POLICY' },
          { text: 'Refund Policy', link: '/REFUND-POLICY' }
        ]
      },
      { text: 'GitHub', link: 'https://github.com/epikodelabs/streamix-community' }
    ],

    sidebar: {
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Enumerations', link: '/api/#enumerations' },
            { text: 'Functions', link: '/api/#functions' },
            { text: 'Interfaces', link: '/api/#interfaces' },
            { text: 'Type Aliases', link: '/api/#type-aliases' },
            { text: 'Variables', link: '/api/#variables' }
          ]
        }
      ],
      '/': [
        {
          text: 'Documentation',
          items: [
            { text: 'Getting Started', link: '/' },
            { text: 'Pricing', link: '/PRICING' },
            { text: 'Changelog', link: '/CHANGELOG' },
            { text: 'Migration Guide', link: '/MIGRATION' },  // Main migration guide
            { text: 'Atoms', link: '/ATOMS' },
            { text: 'Coroutines', link: '/COROUTINES' },
            { text: 'Actors', link: '/ACTORS' },
            { text: 'Generators', link: '/GENERATORS' },
            { text: 'IoC Containers', link: '/IOC' },
            { text: 'Angular', link: '/ANGULAR' },
            { text: 'React', link: '/REACT' },
            { text: 'Presentation', link: '/PRESENTATION' }
          ]
        },
        {
          text: 'Legal',
          items: [
            { text: 'Terms of Service', link: '/TERMS-OF-SERVICE' },
            { text: 'Privacy Policy', link: '/PRIVACY-POLICY' },
            { text: 'Refund Policy', link: '/REFUND-POLICY' }
          ]
        },
        {
          text: 'API Reference',
          items: [
            { text: 'Full API Docs', link: '/api/' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/epikodelabs/streamix-community' }
    ],

    footer: {
      message: 'Released under the GNU AGPL v3 or later.',
      copyright: 'Copyright © 2026 epikodelabs'
    },

    search: {
      provider: 'local'
    },

    lastUpdated: {
      text: 'Updated at',
      formatOptions: {
        timeZone: 'UTC',
        timeZoneName: 'short',
        dateStyle: 'full',
        timeStyle: 'medium'
      }
    }
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
    lineNumbers: true
  },

  head: [
    ['meta', { charset: 'utf-8' }],
    ['link', { rel: 'icon', href: '/streamix/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#3c82f6' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:locale', content: 'en' }],
    ['meta', { name: 'og:site_name', content: 'streamix' }],
    ['script', { 
      src: 'https://www.googletagmanager.com/gtag/js?id=G-R225GQFN7D',
      async: ''
    }],
    ['script', {}, `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-R225GQFN7D');
    `]
  ]
})