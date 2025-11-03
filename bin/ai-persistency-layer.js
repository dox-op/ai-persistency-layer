#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.join(here, "..", "dist", "cli.js");

if (!fs.existsSync(distEntry)) {
  console.error(
    "ai-persistency-layer: compiled output missing. Reinstall the package or run `pnpm build` before publishing.",
  );
  process.exit(1);
}

import(pathToFileURL(distEntry).href).catch((error) => {
  console.error("Failed to start ai-persistency-layer CLI:", error);
  process.exitCode = 1;
});
