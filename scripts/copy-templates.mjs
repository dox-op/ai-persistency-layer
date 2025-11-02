import { mkdir, readdir, stat, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const sourceDir = path.join(root, "src", "lib", "templates");
const targetDir = path.join(root, "dist", "lib", "templates");

async function copyRecursive(src, dest) {
  const entryStats = await stat(src);
  if (entryStats.isDirectory()) {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src);
    await Promise.all(
      entries.map(async (entry) => {
        const from = path.join(src, entry);
        const to = path.join(dest, entry);
        await copyRecursive(from, to);
      }),
    );
  } else {
    await copyFile(src, dest);
  }
}

async function main() {
  await rm(targetDir, { recursive: true, force: true });
  await copyRecursive(sourceDir, targetDir);
}

main().catch((error) => {
  console.error("Failed to copy template files:", error);
  process.exit(1);
});
