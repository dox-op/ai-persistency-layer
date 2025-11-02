#!/usr/bin/env node
import("../dist/cli.js").catch((error) => {
  console.error("Failed to start ai-persistency-layer CLI:", error);
  process.exitCode = 1;
});
