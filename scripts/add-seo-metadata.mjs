import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const distRoot = path.join(repoRoot, 'dist');

// Configuration
const SITE_URL = 'https://epikodelabs.github.io/streamix';
const SITE_NAME = 'streamix';
const SITE_DESCRIPTION = 'Reactive streams built on async generators. Small bundle, pull-based execution, and a familiar operator API.';
const DEFAULT_IMAGE = `${SITE_URL}/LOGO.png`;

// Page-specific metadata
const PAGE_METADATA = {
  // =================================================================
  // HOMEPAGE
  // =================================================================
  'index.md': {
    title: 'streamix - Reactive Streams for JavaScript',
    description: 'Reactive streams built on async generators. Small bundle, pull-based execution, and a familiar operator API.',
    keywords: ['reactive', 'streams', 'async generators', 'javascript', 'typescript', 'reactive programming']
  },

  // =================================================================
  // CORE FEATURES & CONCEPTS
  // =================================================================
  'INTRODUCTION.md': {
    title: 'Getting Started with streamix',
    description: 'Introduction to streamix reactive streams library. Learn the basics and get started with reactive programming.',
    keywords: ['introduction', 'getting started', 'tutorial', 'basics', 'reactive streams', 'javascript']
  },

  'COROUTINES.md': {
    title: 'Coroutines - Background Task Processing | streamix',
    description: 'Learn how to use coroutines in streamix to run CPU-heavy work in Web Workers without blocking the main thread.',
    keywords: ['coroutines', 'web workers', 'background tasks', 'async', 'multi-threading', 'worker pools']
  },
  
  'ACTORS.md': {
    title: 'Actors - Bidirectional Worker Messaging | streamix',
    description: 'Use actors for bidirectional worker-to-main-thread messaging with full control over worker lifecycle.',
    keywords: ['actors', 'actors model', 'messaging', 'concurrency', 'web workers', 'bidirectional communication']
  },

  'GENERATORS.md': {
    title: 'Generators - Iterator Protocol | streamix',
    description: 'Explore how streamix uses JavaScript generators and the iterator protocol for efficient async operations.',
    keywords: ['generators', 'iterator', 'async iteration', 'pull-based', 'iterator protocol', 'generator functions']
  },

  'SUBJECTS.md': {
    title: 'Subjects - Event Emitters & Multicast | streamix',
    description: 'Learn about Subject types for multicast event emission and subscription management in streamix.',
    keywords: ['subjects', 'event emitters', 'multicast', 'subscriptions', 'reactivity', 'event handling']
  },

  // =================================================================
  // FRAMEWORK INTEGRATIONS
  // =================================================================
  'ANGULAR.md': {
    title: 'Angular Integration Guide | streamix',
    description: 'Integrate streamix reactive streams with Angular applications for reactive data flow and change detection.',
    keywords: ['angular', 'integration', 'reactive forms', 'data flow', 'change detection', 'rxjs alternative']
  },

  'REACT.md': {
    title: 'React Integration Guide | streamix',
    description: 'Use streamix streams with React hooks and components for reactive state management and effects.',
    keywords: ['react', 'hooks', 'integration', 'state management', 'reactivity', 'useEffect']
  },

  // =================================================================
  // PROJECT INFORMATION
  // =================================================================
  'CHANGELOG.md': {
    title: 'Changelog - Version History & Release Notes | streamix',
    description: 'Track all releases, updates, bug fixes, and improvements to the streamix library. See what changed in each version.',
    keywords: ['changelog', 'releases', 'version history', 'breaking changes', 'updates', 'release notes', 'migrations']
  },

  'PRICING.md': {
    title: 'Pricing & Licensing | streamix',
    description: 'Explore streamix pricing options, licensing plans, and commercial support.',
    keywords: ['pricing', 'license', 'licensing', 'commercial', 'support', 'open source', 'agpl', 'enterprise']
  },

  // =================================================================
  // LEGAL & COMPLIANCE
  // =================================================================
  'TERMS-OF-SERVICE.md': {
    title: 'Terms of Service | streamix',
    description: 'Read the complete terms and conditions for using streamix library and services.',
    keywords: ['terms', 'terms of service', 'legal', 'conditions', 'agreement', 'tos']
  },

  'PRIVACY-POLICY.md': {
    title: 'Privacy Policy | streamix',
    description: 'Learn about how streamix and epikodelabs handle your data, privacy, and comply with regulations like GDPR.',
    keywords: ['privacy', 'privacy policy', 'data protection', 'gdpr', 'security', 'compliance', 'legal']
  },

  'REFUND-POLICY.md': {
    title: 'Refund Policy | streamix',
    description: 'Review the refund policy for streamix licensing, commercial support, and money-back guarantee.',
    keywords: ['refund', 'refund policy', 'money-back', 'guarantee', 'support', 'satisfaction']
  }
};

/**
 * Extract the main heading from markdown content
 */
function extractMainHeading(content) {
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('# ')) {
      return line.replace(/^#+\s+/, '').trim();
    }
  }
  return null;
}

/**
 * Extract the first meaningful paragraph from markdown content
 */
function extractFirstParagraph(content) {
  const lines = content.split('\n');
  let paragraph = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip headings and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      if (paragraph) break;
      continue;
    }

    // Skip image markdown
    if (trimmed.startsWith('![')) {
      continue;
    }

    // Accumulate paragraph text
    if (paragraph) {
      paragraph += ' ';
    }
    paragraph += trimmed;

    // Stop at reasonable length
    if (paragraph.length > 160) {
      break;
    }
  }

  // Remove markdown formatting and trim
  return paragraph
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links
    .replace(/`([^`]+)`/g, '$1') // Remove inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold
    .trim()
    .substring(0, 160) + '...';
}

/**
 * Generate SEO keywords from content
 */
function generateKeywords(content, title, customKeywords = []) {
  if (customKeywords && customKeywords.length > 0) {
    return customKeywords;
  }

  const keywords = new Set();

  // Add technology-specific keywords based on content
  if (content.includes('coroutine')) keywords.add('coroutines');
  if (content.includes('actor')) keywords.add('actors');
  if (content.includes('stream')) keywords.add('streams');
  if (content.includes('reactive')) keywords.add('reactive programming');
  if (content.includes('generator')) keywords.add('generators');
  if (content.includes('subject')) keywords.add('subjects');
  if (content.includes('observable')) keywords.add('observables');
  if (content.includes('Web Worker')) keywords.add('web workers');
  if (content.includes('async')) keywords.add('async');
  if (content.includes('promise')) keywords.add('promises');
  if (content.includes('Angular')) keywords.add('angular');
  if (content.includes('React')) keywords.add('react');
  if (content.includes('TypeScript')) keywords.add('typescript');
  if (content.includes('JavaScript')) keywords.add('javascript');

  // Add general library keywords
  keywords.add('streamix');
  keywords.add('reactive library');

  return Array.from(keywords).slice(0, 8);
}

/**
 * Create YAML frontmatter for a page
 */
function createFrontmatter(filename, content, pageTitle, pageDescription, pageKeywords) {
  const slug = filename.replace(/\.md$/, '').toLowerCase();
  const url = slug === 'index' ? SITE_URL : `${SITE_URL}/${slug}`;

  const metadata = {
    title: pageTitle,
    description: pageDescription,
    keywords: pageKeywords,
    head: [
      // Canonical URL
      ['link', { rel: 'canonical', href: url }],

      // Open Graph
      ['meta', { property: 'og:title', content: pageTitle }],
      ['meta', { property: 'og:description', content: pageDescription }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: SITE_NAME }],
      ['meta', { property: 'og:image', content: DEFAULT_IMAGE }],

      // Twitter Card
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: pageTitle }],
      ['meta', { name: 'twitter:description', content: pageDescription }],
      ['meta', { name: 'twitter:image', content: DEFAULT_IMAGE }],

      // Additional SEO
      ['meta', { name: 'viewport', content: 'width=device-width, initial-scale=1.0' }],
    ]
  };

  // Build YAML frontmatter
  let yaml = '---\n';
  yaml += `title: "${escapeYaml(pageTitle)}"\n`;
  yaml += `description: "${escapeYaml(pageDescription)}"\n`;
  yaml += `keywords:\n`;
  for (const keyword of pageKeywords) {
    yaml += `  - ${escapeYaml(keyword)}\n`;
  }
  yaml += 'head:\n';
  for (const [tag, attrs] of metadata.head) {
    yaml += `  - [${tag}`;
    for (const [key, value] of Object.entries(attrs)) {
      yaml += `, { ${key}: "${escapeYaml(value)}" }`;
    }
    yaml += ']\n';
  }
  yaml += '---\n\n';

  return yaml;
}

/**
 * Escape YAML string values
 */
function escapeYaml(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Check if content already has frontmatter
 */
function hasFrontmatter(content) {
  return content.startsWith('---');
}

/**
 * Remove existing frontmatter
 */
function removeFrontmatter(content) {
  if (!hasFrontmatter(content)) {
    return content;
  }

  const lines = content.split('\n');
  let endMarkerFound = false;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith('---')) {
      return lines.slice(i + 1).join('\n').trim() + '\n';
    }
  }

  return content;
}

/**
 * Process markdown file and add SEO metadata
 */
function processMarkdownFile(filePath, filename) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;

    // Remove existing frontmatter if present
    if (hasFrontmatter(content)) {
      content = removeFrontmatter(content);
    }

    // Get metadata from configuration or extract from content
    let metadata = PAGE_METADATA[filename] || {};

    const title = metadata.title || extractMainHeading(content) || filename.replace(/\.md$/, '');
    const description = metadata.description || extractFirstParagraph(content);
    const keywords = metadata.keywords || generateKeywords(content, title);

    // Create and prepend frontmatter
    const frontmatter = createFrontmatter(filename, content, title, description, keywords);
    const newContent = frontmatter + content;

    // Write updated content
    fs.writeFileSync(filePath, newContent, 'utf8');

    console.log(`✓ Added SEO metadata to ${filename}`);
    return true;
  } catch (error) {
    console.error(`✗ Error processing ${filename}:`, error.message);
    return false;
  }
}

/**
 * Main function
 */
function main() {
  if (!fs.existsSync(distRoot)) {
    console.error(`Error: dist directory not found at ${distRoot}`);
    process.exit(1);
  }

  console.log('🔍 Scanning for markdown files...');

  const files = fs
    .readdirSync(distRoot)
    .filter(file => file.endsWith('.md'));

  if (files.length === 0) {
    console.warn('⚠️  No markdown files found in dist directory');
    process.exit(0);
  }

  console.log(`📄 Found ${files.length} markdown file(s)\n`);

  let processed = 0;
  for (const file of files) {
    if (processMarkdownFile(path.join(distRoot, file), file)) {
      processed++;
    }
  }

  console.log(`\n✅ SEO metadata added to ${processed} file(s)`);
}

main();
