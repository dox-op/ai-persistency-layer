import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import dayjs from "dayjs";
import {
  DEFAULT_BOOTSTRAP_FILE,
  DEFAULT_CONFIG_FILE,
  DEFAULT_LOG_FILE,
  DEFAULT_SNAPSHOT_DIR,
  DEFAULT_START_SCRIPT,
  DEFAULT_ANTI_DRIFT_SLO_DAYS,
  DEFAULT_ANTI_DRIFT_SLO_COMMITS,
  type PersistencyMetadata,
} from "./constants.js";
import type { ResolvedOptions, AntiDriftMetrics } from "./types.js";

const TEMPLATE_ROOT = fileURLToPath(new URL("./templates/", import.meta.url));

async function readTemplate(relativePath: string): Promise<string> {
  const templatePath = path.join(TEMPLATE_ROOT, relativePath);
  return fs.readFile(templatePath, "utf8");
}

async function safeWriteFile(
  filePath: string,
  content: string,
  force: boolean,
): Promise<"created" | "skipped" | "updated"> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(filePath);
    if (!force) {
      return "skipped";
    }
    await fs.writeFile(filePath, content, "utf8");
    return "updated";
  } catch {
    // file does not exist
  }

  await fs.writeFile(filePath, content, "utf8");
  return "created";
}

export async function backupExistingLayer(
  persistencyPath: string,
  projectPath: string,
): Promise<string | undefined> {
  try {
    await fs.access(persistencyPath);
  } catch {
    return undefined;
  }

  const backupDir = path.join(
    projectPath,
    `${path.basename(persistencyPath)}-backup`,
    dayjs().format("YYYYMMDD-HHmmss"),
  );
  await fs.mkdir(backupDir, { recursive: true });
  await fs.cp(persistencyPath, backupDir, { recursive: true });
  return backupDir;
}

export async function copyAssets(
  assets: string[],
  persistencyPath: string,
): Promise<string[]> {
  const copied: string[] = [];
  for (const asset of assets) {
    const absolute = path.resolve(asset);
    try {
      await fs.access(absolute);
      const target = path.join(
        persistencyPath,
        "ai-meta",
        "assets",
        path.basename(asset),
      );
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.cp(absolute, target, { recursive: true });
      copied.push(target);
    } catch (error) {
      console.warn(
        chalk.yellow(`Warning: could not copy asset ${asset}: ${String(error)}`),
      );
    }
  }
  return copied;
}

export async function writeBootstrap(
  options: ResolvedOptions,
  persistencyPath: string,
  metrics: AntiDriftMetrics,
  truthBranch: string,
  snapshotPath: string,
  force: boolean,
): Promise<void> {
  const template = await readTemplate("bootstrap.mdc");
  const content = template
    .replace(/{{projectName}}/g, options.projectName)
    .replace(/{{agent}}/g, options.agent)
    .replace(/{{truthBranch}}/g, truthBranch)
    .replace(/{{snapshotPath}}/g, snapshotPath)
    .replace(/{{daysSinceUpdate}}/g, String(metrics.daysSinceUpdate))
    .replace(/{{commitsSinceTruth}}/g, String(metrics.commitsSinceTruth))
    .replace(/{{sloDays}}/g, String(DEFAULT_ANTI_DRIFT_SLO_DAYS))
    .replace(/{{sloCommits}}/g, String(DEFAULT_ANTI_DRIFT_SLO_COMMITS))
    .replace(/{{defaultModel}}/g, options.defaultModel ?? "unset");

  const filePath = path.join(persistencyPath, DEFAULT_BOOTSTRAP_FILE);
  await safeWriteFile(filePath, content, force);
}

export async function writeDomainFoundations(
  options: ResolvedOptions,
  persistencyPath: string,
  force: boolean,
): Promise<void> {
  const functionalTemplate = await readTemplate(
    path.join("functional", "foundation.mdc"),
  );
  const technicalTemplate = await readTemplate(
    path.join("technical", "foundation.mdc"),
  );
  const aiMetaTemplate = await readTemplate(
    path.join("ai-meta", "foundation.mdc"),
  );

  const functional = functionalTemplate.replace(
    /{{projectName}}/g,
    options.projectName,
  );
  const technical = technicalTemplate.replace(
    /{{projectName}}/g,
    options.projectName,
  );
  const aiMeta = aiMetaTemplate
    .replace(/{{projectName}}/g, options.projectName)
    .replace(/{{agent}}/g, options.agent);

  await safeWriteFile(
    path.join(persistencyPath, "functional", "foundation.mdc"),
    functional,
    force,
  );
  await safeWriteFile(
    path.join(persistencyPath, "technical", "foundation.mdc"),
    technical,
    force,
  );
  await safeWriteFile(
    path.join(persistencyPath, "ai-meta", "foundation.mdc"),
    aiMeta,
    force,
  );
}

export async function writeLegacyImportManifest(
  persistencyPath: string,
  sources: string[],
): Promise<void> {
  const manifestPath = path.join(persistencyPath, "ai-meta", "legacy-import.mdc");
  const template = await readTemplate(path.join("ai-meta", "legacy-import.mdc"));
  const list = (sources.length
    ? sources.map((src) => `- ${src}`).join("\n")
    : "- _(none detected)_: this is a fresh layer.");
  const content = template.replace("{{sourcesList}}", list);
  await safeWriteFile(manifestPath, content, true);
}

export async function writeConfigEnv(
  options: ResolvedOptions,
  persistencyPath: string,
  force: boolean,
  aiCmd: string,
): Promise<void> {
  const rel = (target: string) =>
    path.relative(options.projectPath, target) || ".";
  const functionalDir = path.join(persistencyPath, "functional");
  const technicalDir = path.join(persistencyPath, "technical");
  const aiMetaDir = path.join(persistencyPath, "ai-meta");

  const lines = [
    `# AI Persistency Layer configuration`,
    `PROJECT_NAME=${options.projectName}`,
    `PROJECT_PATH=${options.projectPath}`,
    `PERSISTENCY_DIR=${persistencyPath}`,
    `AI_AGENT=${options.agent}`,
    `AI_CMD=${aiCmd}`,
    `PERSISTENCY_FUNCTIONAL=${rel(functionalDir)}`,
    `PERSISTENCY_TECHNICAL=${rel(technicalDir)}`,
    `PERSISTENCY_AI_META=${rel(aiMetaDir)}`,
  ];
  if (options.defaultModel) {
    lines.push(`AI_DEFAULT_MODEL=${options.defaultModel}`);
  }

  await safeWriteFile(
    path.join(persistencyPath, DEFAULT_CONFIG_FILE),
    `${lines.join("\n")}\n`,
    force,
  );
}

export async function writeStartScript(
  persistencyPath: string,
  aiCmd: string,
  force: boolean,
): Promise<void> {
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'export PROJECT_PERSISTENCY_DIR="$SCRIPT_DIR"',
    'export PROJECT_PERSISTENCY_FUNCTIONAL="$SCRIPT_DIR/functional"',
    'export PROJECT_PERSISTENCY_TECHNICAL="$SCRIPT_DIR/technical"',
    'export PROJECT_PERSISTENCY_AI_META="$SCRIPT_DIR/ai-meta"',
    'export PROJECT_PERSISTENCY_ASSETS="$SCRIPT_DIR/ai-meta/assets"',
    "",
    `exec ${aiCmd} "$@"`,
    "",
  ].join("\n");

  const startPath = path.join(persistencyPath, DEFAULT_START_SCRIPT);
  const result = await safeWriteFile(startPath, script, force);
  if (result !== "skipped") {
    await fs.chmod(startPath, 0o755);
  }
}

export async function writeLogEntry(
  persistencyPath: string,
  message: string,
): Promise<void> {
  const logPath = path.join(persistencyPath, DEFAULT_LOG_FILE);
  const line = `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${message}\n`;
  await fs.appendFile(logPath, line, "utf8");
}

export async function writeMetadata(
  persistencyPath: string,
  metadata: PersistencyMetadata,
): Promise<void> {
  const metaPath = path.join(persistencyPath, ".persistency-meta.json");
  await safeWriteFile(metaPath, JSON.stringify(metadata, null, 2), true);
}

export async function ensureBaseLayout(persistencyPath: string): Promise<void> {
  await Promise.all([
    fs.mkdir(persistencyPath, { recursive: true }),
    fs.mkdir(path.join(persistencyPath, "functional"), { recursive: true }),
    fs.mkdir(path.join(persistencyPath, "technical"), { recursive: true }),
    fs.mkdir(path.join(persistencyPath, "ai-meta"), { recursive: true }),
    fs.mkdir(path.join(persistencyPath, "ai-meta", "legacy"), {
      recursive: true,
    }),
    fs.mkdir(
      path.join(persistencyPath, "ai-meta", "assets"),
      { recursive: true },
    ),
    fs.mkdir(
      path.join(persistencyPath, DEFAULT_SNAPSHOT_DIR),
      { recursive: true },
    ),
  ]);
}

export async function writeAntiDriftScripts(
  projectPath: string,
  persistencyRelDir: string,
  force: boolean,
): Promise<void> {
  const scriptsDir = path.join(projectPath, "scripts", "ai");
  const checkFile = path.join(scriptsDir, "check-stale.ts");
  const refreshFile = path.join(scriptsDir, "refresh-layer.ts");

  const checkTemplate = await readTemplate("anti-drift/check-stale.ts.txt");
  const refreshTemplate = await readTemplate("anti-drift/refresh-layer.ts.txt");

  await safeWriteFile(
    checkFile,
    checkTemplate
      .replace(/{{persistencyDir}}/g, persistencyRelDir)
      .replace(/{{sloDays}}/g, String(DEFAULT_ANTI_DRIFT_SLO_DAYS))
      .replace(/{{sloCommits}}/g, String(DEFAULT_ANTI_DRIFT_SLO_COMMITS)),
    force,
  );
  await safeWriteFile(
    refreshFile,
    refreshTemplate.replace(/{{persistencyDir}}/g, persistencyRelDir),
    force,
  );
}
