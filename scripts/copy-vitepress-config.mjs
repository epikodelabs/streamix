import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourcePath = path.join(repoRoot, "vitepress.config.ts");
const targetDir = path.join(repoRoot, "dist", ".vitepress");
const targetPath = path.join(targetDir, "config.ts");

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(sourcePath, targetPath);
