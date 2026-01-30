import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// VitePress builds from 'dist' to 'dist/.vitepress/dist'
const distRoot = path.join(process.cwd(), 'dist', '.vitepress', 'dist');
const configPath = path.join(process.cwd(), 'vitepress.config.ts');

function normalizeBasePath(value) {
  let base = String(value || '').trim();
  if (!base || base === '/') {
    return '/';
  }
  if (!base.startsWith('/')) {
    base = `/${base}`;
  }
  if (!base.endsWith('/')) {
    base = `${base}/`;
  }
  return base;
}

function readBasePath() {
  try {
    const config = fs.readFileSync(configPath, 'utf8');
    const match = config.match(/base:\s*['"`]([^'"`]+)['"`]/);
    if (match) {
      return normalizeBasePath(match[1]);
    }
  } catch (err) {
    console.warn('Could not read base path from config, using default "/"');
    console.warn('Error:', err.message);
  }
  return '/';
}

const basePath = readBasePath();
console.log(`Using base path: ${basePath}`);

// If base is just "/", no rewriting needed
if (basePath === '/') {
  console.log('Base path is root, no rewriting necessary.');
  process.exit(0);
}

// Check if dist folder exists
if (!fs.existsSync(distRoot)) {
  console.error(`Error: Built site not found at ${distRoot}`);
  console.error('Current working directory:', process.cwd());
  console.error('Looking for:', distRoot);
  console.error('\nMake sure VitePress has built the site first.');
  process.exit(1);
}

const baseSegment = basePath.replace(/^\/+|\/+$/g, ''); // "streamix"

function processDirectory(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  let filesProcessed = 0;
  
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    
    if (file.isDirectory()) {
      filesProcessed += processDirectory(fullPath);
    } else if (file.isFile()) {
      const ext = path.extname(file.name).toLowerCase();
      
      if (['.html', '.js', '.css', '.json'].includes(ext)) {
        try {
          let content = fs.readFileSync(fullPath, 'utf8');
          let updated = content;
          
          // Replace absolute paths that don't already have the base prefix
          updated = updated.replace(
            /(["'`])\/(?!\/|http|https|data:|mailto:)([^"'`]*)(["'`])/g,
            (match, openQuote, pathContent, closeQuote) => {
              if (pathContent.startsWith(baseSegment)) {
                return match;
              }
              if (!pathContent) {
                return match;
              }
              return `${openQuote}${basePath}${pathContent}${closeQuote}`;
            }
          );
          
          // Handle CSS url()
          updated = updated.replace(
            /url\(\s*(['"]?)\/(?!\/|http|https|data:)([^)'"]*)(['"]?)\s*\)/g,
            (match, openQuote, pathContent, closeQuote) => {
              if (pathContent.startsWith(baseSegment)) {
                return match;
              }
              if (!pathContent) {
                return match;
              }
              return `url(${openQuote}${basePath}${pathContent}${closeQuote})`;
            }
          );
          
          if (updated !== content) {
            fs.writeFileSync(fullPath, updated, 'utf8');
            const relativePath = path.relative(distRoot, fullPath);
            console.log(`✓ Updated: ${relativePath}`);
            filesProcessed++;
          }
        } catch (err) {
          // Skip binary or unreadable files
        }
      }
    }
  }
  
  return filesProcessed;
}

console.log(`\nProcessing built site at: ${distRoot}\n`);

const totalFiles = processDirectory(distRoot);

console.log(`\n✓ Complete. ${totalFiles} file(s) updated.`);