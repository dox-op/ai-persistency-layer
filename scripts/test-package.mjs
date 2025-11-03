import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const run = promisify(exec);

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDistTemplates() {
  const requiredFiles = [
    "dist/lib/templates/bootstrap.mdc",
    "dist/lib/templates/functional/foundation.mdc",
    "dist/lib/templates/technical/foundation.mdc",
    "dist/lib/templates/ai-meta/foundation.mdc",
    "dist/lib/templates/ai-meta/legacy-import.mdc",
    "dist/lib/templates/anti-drift/check-stale.ts.txt",
    "dist/lib/templates/anti-drift/refresh-layer.ts.txt"
  ];

  const missing = [];
  for (const file of requiredFiles) {
    if (!(await fileExists(path.resolve(file)))) {
      missing.push(file);
    }
  }

  if (missing.length) {
    throw new Error(`Missing required dist template files: ${missing.join(", ")}`);
  }
}

async function ensureCliRuns() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "apl-test-"));
  try {
    await run("git init", { cwd: tmpDir });
    await run("git branch -M main", { cwd: tmpDir });
    await run("git config user.email tester@example.com", { cwd: tmpDir });
    await run("git config user.name Test User", { cwd: tmpDir });
    await run("git commit --allow-empty -m initial", { cwd: tmpDir });

    const command = [
      "node",
      "./dist/cli.js",
      "--project-name",
      "sample",
      "--project-path",
      tmpDir,
      "--persistency-dir",
      "ai",
      "--agent",
      "codex",
      "--prod-branch",
      "main",
      "--ai-cmd",
      "node",
      "--install-method",
      "skip",
      "--non-interactive",
      "--yes",
      "--write-config"
    ].join(" ");

    await run(command, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "tester@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "tester@example.com"
      }
    });

    const metadataPath = path.join(tmpDir, "ai", ".persistency-meta.json");

    const expectedOutputs = [
      path.join(tmpDir, "ai", "functional", "foundation.mdc"),
      path.join(tmpDir, "ai", "technical", "foundation.mdc"),
      path.join(tmpDir, "ai", "ai-meta", "foundation.mdc"),
      path.join(tmpDir, "ai", "ai-meta", "legacy-import.mdc"),
      path.join(tmpDir, "ai", "technical", "snapshots"),
      path.join(tmpDir, "ai", "ai-bootstrap.mdc"),
      metadataPath
    ];

    for (const file of expectedOutputs) {
      if (!(await fileExists(file))) {
        throw new Error(`Expected file not generated: ${file}`);
      }
    }

    const nonInteractiveCommand = [
      "node",
      "./dist/cli.js",
      "--project-path",
      tmpDir,
      "--non-interactive",
      "--yes",
      "--ai-cmd",
      "node",
      "--install-method",
      "skip",
      "--write-config",
      "--force"
    ].join(" ");

    await run(nonInteractiveCommand, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "tester@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "tester@example.com"
      }
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  await ensureDistTemplates();
  await ensureCliRuns();
  console.log("Package validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
