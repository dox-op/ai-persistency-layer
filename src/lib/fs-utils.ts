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

const TEMPLATE_ROOT = path.dirname(fileURLToPath(new URL("./templates/", import.meta.url)));

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
      const target = path.join(persistencyPath, "assets", path.basename(asset));
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

export async function writeRulesAndKnowledge(
  options: ResolvedOptions,
  persistencyPath: string,
  force: boolean,
): Promise<void> {
  const rulesTemplate = await readTemplate(path.join("rules", "core.mdc"));
  const knowledgeTemplate = await readTemplate(
    path.join("knowledge", "foundation.mdc"),
  );

  const enrichedRules = rulesTemplate.replace(
    /{{projectName}}/g,
    options.projectName,
  );

  const enrichedKnowledge = knowledgeTemplate
    .replace(/{{projectName}}/g, options.projectName)
    .replace(/{{agent}}/g, options.agent);

  await safeWriteFile(
    path.join(persistencyPath, "rules", "core.mdc"),
    enrichedRules,
    force,
  );
  await safeWriteFile(
    path.join(persistencyPath, "knowledge", "foundation.mdc"),
    enrichedKnowledge,
    force,
  );
}

export async function writeConfigEnv(
  options: ResolvedOptions,
  persistencyPath: string,
  force: boolean,
  aiCmd: string,
): Promise<void> {
  const lines = [
    `# AI Persistency Layer configuration`,
    `PROJECT_NAME=${options.projectName}`,
    `PROJECT_PATH=${options.projectPath}`,
    `PERSISTENCY_DIR=${persistencyPath}`,
    `AI_AGENT=${options.agent}`,
    `AI_CMD=${aiCmd}`,
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
    'SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"',
    "export PROJECT_PERSISTENCY_DIR=\"$SCRIPT_DIR\"",
    "export PROJECT_PERSISTENCY_RULES=\"$SCRIPT_DIR/rules\"",
    "export PROJECT_PERSISTENCY_KNOWLEDGE=\"$SCRIPT_DIR/knowledge\"",
    "export PROJECT_PERSISTENCY_ASSETS=\"$SCRIPT_DIR/assets\"",
    "",
    `exec ${aiCmd} \"$@\"`,
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
    fs.mkdir(path.join(persistencyPath, "rules"), { recursive: true }),
    fs.mkdir(path.join(persistencyPath, "knowledge"), { recursive: true }),
    fs.mkdir(path.join(persistencyPath, "agents"), { recursive: true }),
    fs.mkdir(path.join(persistencyPath, "assets"), { recursive: true }),
    fs.mkdir(path.join(persistencyPath, DEFAULT_SNAPSHOT_DIR), {
      recursive: true,
    }),
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
