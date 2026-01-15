import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/streamix/',
  lang: 'en-US',
  title: 'streamix',
  description: 'Reactive library documentation',
  mpa: true,

  cleanUrls: true,

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Changelog', link: '/CHANGELOG' },
      { text: 'API Reference', link: '/api/' },
      { text: 'GitHub', link: 'https://github.com/epikodelabs/streamix' }
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
            { text: 'Changelog', link: '/CHANGELOG' },
            { text: 'Coroutines', link: '/COROUTINES' },
            { text: 'Generators', link: '/GENERATORS' },
            { text: 'Subjects', link: '/SUBJECTS' },
            { text: 'RxJS', link: '/RXJS' },
            { text: 'React', link: '/REACT' },
            { text: 'Angular', link: '/ANGULAR' },
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
      copyright: 'Copyright © 2025 epikodelabs'
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
    ['meta', { name: 'og:site_name', content: 'streamix' }]
  ]
})
