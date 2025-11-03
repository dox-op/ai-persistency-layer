import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, access, readFile, mkdir, writeFile } from "node:fs/promises";
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
    "dist/lib/knowledge-base/bootstrap.mdc",
    "dist/lib/knowledge-base/functional/foundation.mdc",
    "dist/lib/knowledge-base/technical/foundation.mdc",
    "dist/lib/knowledge-base/ai-meta/foundation.mdc",
    "dist/lib/knowledge-base/ai-meta/migration-brief.mdc",
    "dist/lib/resources/anti-drift/check-stale.ts.int",
    "dist/lib/resources/anti-drift/refresh-layer.ts.int"
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

    const layerRoot = path.join(tmpDir, "custom-ai");
    await mkdir(path.join(layerRoot, "functional"), { recursive: true });
    await mkdir(path.join(layerRoot, "technical"), { recursive: true });
    await mkdir(path.join(layerRoot, "ai-meta"), { recursive: true });
    await mkdir(path.join(layerRoot, "archive"), { recursive: true });
    await writeFile(
      path.join(layerRoot, "functional", "legacy-note.mdc"),
      "# Legacy functional note\n\nOriginal content that must be preserved.",
      "utf8",
    );
    await writeFile(
      path.join(layerRoot, "ai-bootstrap.mdc"),
      "# Existing bootstrap\n\n- archive/2022-snapshots",
      "utf8",
    );

    const command = [
      "node",
      "./dist/cli.js",
      "--project-name",
      "sample",
      "--project-path",
      tmpDir,
      "--persistency-dir",
      "custom-ai",
      "--agent",
      "codex",
      "--prod-branch",
      "main",
      "--ai-cmd",
      "node",
      "--install-method",
      "skip",
      "--intake-notes",
      "Legacy-CSV-export=./data/users.csv",
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

    const metadataPath = path.join(tmpDir, "custom-ai", ".persistency-meta.json");
    const pointerPath = path.join(tmpDir, ".persistency-path");

    const expectedOutputs = [
      path.join(tmpDir, "custom-ai", "functional", "foundation.mdc"),
      path.join(tmpDir, "custom-ai", "functional", "index.mdc"),
      path.join(tmpDir, "custom-ai", "functional", "legacy-note.mdc"),
      path.join(tmpDir, "custom-ai", "technical", "foundation.mdc"),
      path.join(tmpDir, "custom-ai", "technical", "index.mdc"),
      path.join(tmpDir, "custom-ai", "ai-meta", "foundation.mdc"),
      path.join(tmpDir, "custom-ai", "ai-meta", "index.mdc"),
      path.join(tmpDir, "custom-ai", "ai-meta", "migration-brief.mdc"),
      path.join(tmpDir, "custom-ai", "ai-bootstrap.mdc"),
      path.join(tmpDir, "persistency.upsert.prompt.mdc"),
      metadataPath,
      pointerPath
    ];

    for (const file of expectedOutputs) {
      if (!(await fileExists(file))) {
        throw new Error(`Expected file not generated: ${file}`);
      }
    }

    const legacyContent = await readFile(
      path.join(tmpDir, "custom-ai", "functional", "legacy-note.mdc"),
      "utf8",
    );
    if (!legacyContent.includes("Original content that must be preserved.")) {
      throw new Error("Legacy functional note was unexpectedly modified.");
    }

    const snapshotsDir = path.join(tmpDir, "custom-ai", "technical", "snapshots");
    if (await fileExists(snapshotsDir)) {
      throw new Error(`Snapshots directory should not be generated: ${snapshotsDir}`);
    }

    const pointerContents = (await readFile(pointerPath, "utf8")).trim();
    if (pointerContents !== "custom-ai") {
      throw new Error(
        `Expected persistency pointer to equal "custom-ai" but received "${pointerContents}"`,
      );
    }

    const brief = await readFile(
      path.join(tmpDir, "custom-ai", "ai-meta", "migration-brief.mdc"),
      "utf8",
    );
    if (!brief.includes("Legacy-CSV-export=./data/users.csv")) {
      throw new Error("Migration brief does not include supplemental notes.");
    }
    if (!brief.includes("archive")) {
      throw new Error("Migration brief did not mention the extra archive directory.");
    }

    const upsertPrompt = await readFile(
      path.join(tmpDir, "persistency.upsert.prompt.mdc"),
      "utf8",
    );
    if (!upsertPrompt.includes("custom-ai/ai-meta/migration-brief.mdc")) {
      throw new Error("Upsert prompt did not reference the migration brief path.");
    }
    if (!upsertPrompt.includes("custom-ai/archive")) {
      throw new Error("Upsert prompt did not reference the existing archive directory.");
    }
    if (!upsertPrompt.includes("Legacy-CSV-export=./data/users.csv")) {
      throw new Error("Upsert prompt is missing supplemental notes.");
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
