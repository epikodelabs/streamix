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
      { text: 'GitHub', link: 'https://github.com/epikodelabs/streamix' }
    ],

    sidebar: {
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Core', link: '/api/src/public-api/' },
            { text: 'Angular', link: '/api/angular/src/public-api/' },
            { text: 'React', link: '/api/react/src/public-api/' },
            { text: 'Vue', link: '/api/vue/src/public-api/' },
            { text: 'DOM', link: '/api/dom/src/public-api/' },
            { text: 'Networking', link: '/api/networking/src/public-api/' },
            { text: 'Aggregates', link: '/api/aggregates/src/public-api/' }
          ]
        }
      ],
      '/': [
        {
          text: 'Documentation',
          items: [
            { text: 'Getting Started', link: '/' },
            { text: 'Atoms', link: '/ATOMS' },
            { text: 'Generators', link: '/GENERATORS' },
            { text: 'Migration', link: '/MIGRATION' },
            { text: 'Angular', link: '/ANGULAR' },
            { text: 'React', link: '/REACT' },
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
      { icon: 'github', link: 'https://github.com/epikodelabs/streamix' }
    ],

    footer: {
      message: 'Released under the MIT License.',
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