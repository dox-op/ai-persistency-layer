import { mkdir, readdir, stat, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const knowledgeSource = path.join(root, "src", "lib", "knowledge-base");
const knowledgeTarget = path.join(root, "dist", "lib", "knowledge-base");
const resourcesSource = path.join(root, "src", "lib", "resources");
const resourcesTarget = path.join(root, "dist", "lib", "resources");

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
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
}

async function syncDir(src, dest) {
  await rm(dest, { recursive: true, force: true });
  await copyRecursive(src, dest);
}

async function main() {
  await Promise.all([
    syncDir(knowledgeSource, knowledgeTarget),
    syncDir(resourcesSource, resourcesTarget),
  ]);
}

main().catch((error) => {
  console.error("Failed to copy template files:", error);
  process.exit(1);
});
