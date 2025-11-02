#!/usr/bin/env node
import("../dist/cli.js").catch((error) => {
  console.error("Failed to start init-persistency-layer CLI:", error);
  process.exitCode = 1;
});
