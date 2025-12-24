import { promises as fs } from "fs";
import path from "path";

const srcRoot = path.resolve("docs-build");
const destRoot = path.resolve("docs");

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(srcDir, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  if (!(await exists(srcRoot))) {
    console.error(`Build output not found: ${srcRoot}`);
    process.exit(1);
  }

  await copyDir(srcRoot, destRoot);
  console.log(`Copied ${srcRoot} -> ${destRoot}`);
}

main().catch((error) => {
  console.error("Failed to copy docs build output:", error);
  process.exit(1);
});
