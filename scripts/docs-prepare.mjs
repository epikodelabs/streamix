import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const distRoot = path.join(repoRoot, 'dist');
const apiRoot = path.join(distRoot, 'api');
const docsRoot = path.join(repoRoot, 'docs');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listMarkdownFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

function copyIfMissing(src, dest) {
  if (!fs.existsSync(dest)) {
    copyFile(src, dest);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

ensureDir(distRoot);
ensureDir(apiRoot);

const readmePath = path.join(repoRoot, 'README.md');
if (!fs.existsSync(readmePath)) {
  throw new Error('README.md not found in repository root.');
}

const indexPath = path.join(distRoot, 'index.md');
copyFile(readmePath, indexPath);

if (fs.existsSync(docsRoot)) {
  for (const fileName of listMarkdownFiles(docsRoot)) {
    if (fileName.toLowerCase() === 'readme.md') {
      continue;
    }
    copyFile(path.join(docsRoot, fileName), path.join(distRoot, fileName));
  }
}

for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue;
  }
  if (!entry.name.toLowerCase().endsWith('.md')) {
    continue;
  }
  if (entry.name.toLowerCase() === 'readme.md') {
    continue;
  }
  copyIfMissing(path.join(repoRoot, entry.name), path.join(distRoot, entry.name));
}

let indexContent = readText(indexPath);
if (!indexContent.includes('## API Reference')) {
  indexContent = indexContent.trimEnd() + '\n\n## API Reference\n';
  indexContent += 'Check the detailed [API Reference here](./api/).\n';
  writeText(indexPath, indexContent);
}

const distMarkdown = listMarkdownFiles(distRoot);
const targets = distMarkdown
  .map((name) => path.basename(name, '.md'))
  .filter((name) => name.toLowerCase() !== 'index');

for (const fileName of distMarkdown) {
  const filePath = path.join(distRoot, fileName);
  let content = readText(filePath);
  const original = content;

  for (const target of targets) {
    const escaped = escapeRegExp(target);
    content = content.replace(
      new RegExp(`\\]\\(\\./${escaped}\\.md\\)`, 'g'),
      `](./${target})`
    );
    content = content.replace(
      new RegExp(`\\]\\(/${escaped}\\.md\\)`, 'g'),
      `](/${target})`
    );
  }

  content = content.replace(/]\(\.\/README\.md\)/g, '](./)');
  content = content.replace(/]\(\.\/README\)/g, '](./)');
  content = content.replace(/]\(\/README\.md\)/g, '](/)');
  content = content.replace(/]\(\/README\)/g, '](/)');

  if (content !== original) {
    writeText(filePath, content);
  }
}
