import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const distRoot = path.join(repoRoot, 'dist', '.vitepress', 'dist');

function normalizeBase(value) {
  let base = (value ?? '').trim();
  if (!base) {
    return '/streamix/';
  }
  if (!base.startsWith('/')) {
    base = `/${base}`;
  }
  if (!base.endsWith('/')) {
    base = `${base}/`;
  }
  return base;
}

function detectBaseFromVitepressConfig() {
  const configPath = path.join(repoRoot, 'vitepress.config.ts');
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  const content = fs.readFileSync(configPath, 'utf8');
  const match = content.match(/\bbase\s*:\s*(['"])(.*?)\1/);
  return match?.[2];
}

const basePath = normalizeBase(process.env.VITEPRESS_BASE ?? detectBaseFromVitepressConfig());

function processDirectory(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    
    if (file.isDirectory()) {
      processDirectory(fullPath);
    } else if (file.isFile()) {
      const ext = path.extname(file.name).toLowerCase();
      
      // Only process text files
      if (['.html', '.js', '.css', '.json', '.map'].includes(ext)) {
        try {
          let content = fs.readFileSync(fullPath, 'utf8');
          
          // Simple but effective replacements
          let updated = content
            // Handle /assets/ paths with both single and double quotes
            .replace(/"\/assets\//g, `"${basePath}assets/`)
            // Handle root files with both single and double quotes
            .replace(/"\/(hashmap\.json|manifest\.webmanifest|vp-icons\.css)/g, `"${basePath}$1`)
            .replace(/'(\/(hashmap\.json|manifest\.webmanifest|vp-icons\.css))/g, `'${basePath}$1`)
            // Handle CSS url() paths
            .replace(/url\(\//g, `url(${basePath}`)
            // Handle /@vite/ paths with both single and double quotes
            .replace(/"\/@vite\//g, `"${basePath}@vite/`);
          
          // Also handle any other absolute paths that might have been missed
          // This catches things like /some-file.js, /another-path, etc.
          updated = updated.replace(/(["'(]\s*)\/([a-zA-Z0-9_\-][^"')\s]*)/g, (match, prefix, rest) => {
            // Skip if it looks like a URL
            if (rest.startsWith('http') || rest.startsWith('data:') || rest.startsWith('//')) {
              return match;
            }
            // Skip if it's already been processed
            const baseNoLeadingSlash = basePath.replace(/^\/+/, '');
            if (rest.startsWith(baseNoLeadingSlash)) {
              return match;
            }
            return `${prefix}${basePath}${rest}`;
          });
          
          if (updated !== content) {
            fs.writeFileSync(fullPath, updated, 'utf8');
            console.log(`Updated: ${path.relative(distRoot, fullPath)}`);
          }
        } catch (err) {
          // Skip binary files
        }
      }
    }
  }
}

// Check if dist folder exists
if (!fs.existsSync(distRoot)) {
  console.error(`Error: dist folder not found at ${distRoot}`);
  console.error('Current directory:', process.cwd());
  process.exit(1);
}

console.log(`Rewriting paths for base: ${basePath}`);
processDirectory(distRoot);
console.log('✅ Done!');