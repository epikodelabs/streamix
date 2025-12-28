import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitepress'

const docsDir = path.resolve(process.cwd(), 'docs')

function formatDocLabel(fileBase: string) {
  const normalized = fileBase
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
  return normalized
}

function getDocsSidebarItems() {
  if (!fs.existsSync(docsDir)) {
    return [
      { text: 'Getting Started', link: '/' },
      { text: 'Changelog', link: '/CHANGELOG' }
    ]
  }

  const files = fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)

  const items = files
    .map((fileName) => {
      const base = fileName.replace(/\.md$/i, '')
      if (base.toLowerCase() === 'readme') {
        return { text: 'Getting Started', link: '/' }
      }
      return { text: formatDocLabel(base), link: `/${base}` }
    })
    .sort((a, b) => {
      if (a.link === '/') return -1
      if (b.link === '/') return 1
      return a.text.localeCompare(b.text)
    })

  return items
}

export default defineConfig({
  base: '/streamix/',
  srcDir: './', // Use root of dist as source
  title: 'streamix',
  description: 'Reactive library documentation',

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
          items: getDocsSidebarItems()
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
    ['link', { rel: 'icon', href: '/streamix/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#3c82f6' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:locale', content: 'en' }],
    ['meta', { name: 'og:site_name', content: 'Streamix' }]
  ]
})
