import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const apiRoot = path.join(repoRoot, 'dist', 'api');

const replacements = [
  [/\(\.\/index\)/g, '(./)'],
  [/\(\.\/README\)/g, '(./)'],
  [/\(\.\/README\.md\)/g, '(./)'],
  [/\(\.\/\.\.\/index\)/g, '(../)'],
  [/\(\.\/\.\.\/README\)/g, '(../)'],
  [/\(\.\/\.\.\/README\.md\)/g, '(../)'],
  [/\(\.\.\/index\)/g, '(../)'],
  [/\(\.\.\/README\)/g, '(../)'],
  [/\(\.\.\/README\.md\)/g, '(../)'],
  [/\(\.\.\/\.\.\/index\)/g, '(../../)'],
  [/\(\.\.\/\.\.\/README\)/g, '(../../)'],
  [/\(\.\.\/\.\.\/README\.md\)/g, '(../../)'],
];

const readmePath = path.join(apiRoot, 'README.md');
const indexPath = path.join(apiRoot, 'index.md');

if (fs.existsSync(readmePath) && !fs.existsSync(indexPath)) {
  fs.renameSync(readmePath, indexPath);
}

function processDirectory(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processDirectory(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
      continue;
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    let updated = content;
    for (const [pattern, replacement] of replacements) {
      updated = updated.replace(pattern, replacement);
    }
    if (updated !== content) {
      fs.writeFileSync(fullPath, updated, 'utf8');
    }
  }
}

processDirectory(apiRoot);
