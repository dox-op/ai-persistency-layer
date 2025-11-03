import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import dayjs from "dayjs";
import {
  DEFAULT_BOOTSTRAP_FILE,
  DEFAULT_CONFIG_FILE,
  DEFAULT_LOG_FILE,
  DEFAULT_START_SCRIPT,
  DEFAULT_UPSERT_SCRIPT,
  DEFAULT_ANTI_DRIFT_SLO_DAYS,
  DEFAULT_ANTI_DRIFT_SLO_COMMITS,
  PERSISTENCY_METADATA_FILE,
  PERSISTENCY_POINTER_FILE,
  UPSERT_PROMPT_FILE,
  type PersistencyMetadata,
} from "./constants.js";
import type { ResolvedOptions, AntiDriftMetrics } from "./types.js";

const KNOWLEDGE_BASE_ROOT = fileURLToPath(
  new URL("./knowledge-base/", import.meta.url),
);
const RESOURCES_ROOT = fileURLToPath(
  new URL("./resources/", import.meta.url),
);

async function readKnowledgeBase(relativePath: string): Promise<string> {
  const templatePath = path.join(KNOWLEDGE_BASE_ROOT, relativePath);
  return fs.readFile(templatePath, "utf8");
}

async function readResource(relativePath: string): Promise<string> {
  const resourcePath = path.join(RESOURCES_ROOT, relativePath);
  return fs.readFile(resourcePath, "utf8");
}

const CANONICAL_DOMAIN_DIRS = ["functional", "technical", "ai-meta"] as const;

export interface LayoutAnalysis {
  directories: string[];
  extraDirectories: string[];
  referencedExtras: string[];
  unreferencedExtras: string[];
  missingCanonicalDirs: string[];
  bootstrapFound: boolean;
}

export async function analyzePersistencyLayout(
  persistencyPath: string,
): Promise<LayoutAnalysis> {
  const dirs: string[] = [];
  try {
    const entries = await fs.readdir(persistencyPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.push(entry.name);
      }
    }
  } catch {
    return {
      directories: [],
      extraDirectories: [],
      referencedExtras: [],
      unreferencedExtras: [],
      missingCanonicalDirs: [...CANONICAL_DOMAIN_DIRS],
      bootstrapFound: false,
    };
  }

  const canonicalSet = new Set<string>(CANONICAL_DOMAIN_DIRS);
  const extraDirectories = dirs.filter(
    (dir) =>
      !canonicalSet.has(dir) &&
      !dir.startsWith(".") &&
      dir !== "node_modules",
  );

  const bootstrapPath = path.join(persistencyPath, DEFAULT_BOOTSTRAP_FILE);
  let bootstrapContent = "";
  let bootstrapFound = false;
  try {
    bootstrapContent = await fs.readFile(bootstrapPath, "utf8");
    bootstrapFound = true;
  } catch {
    bootstrapFound = false;
  }

  const referencedExtras: string[] = [];
  const unreferencedExtras: string[] = [];

  for (const dir of extraDirectories) {
    if (bootstrapFound && bootstrapContent.includes(dir)) {
      referencedExtras.push(dir);
    } else {
      unreferencedExtras.push(dir);
    }
  }

  const missingCanonicalDirs = CANONICAL_DOMAIN_DIRS.filter(
    (dir) => !dirs.includes(dir),
  );

  return {
    directories: dirs,
    extraDirectories,
    referencedExtras,
    unreferencedExtras,
    missingCanonicalDirs,
    bootstrapFound,
  };
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
  truthCommit: string,
  force: boolean,
): Promise<void> {
  const template = await readKnowledgeBase("bootstrap.mdc");
  const content = template
    .replace(/{{projectName}}/g, options.projectName)
    .replace(/{{agent}}/g, options.agent)
    .replace(/{{truthBranch}}/g, truthBranch)
    .replace(/{{truthCommit}}/g, truthCommit)
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
  const functionalTemplate = await readKnowledgeBase(
    path.join("functional", "foundation.mdc"),
  );
  const technicalTemplate = await readKnowledgeBase(
    path.join("technical", "foundation.mdc"),
  );
  const aiMetaTemplate = await readKnowledgeBase(
    path.join("ai-meta", "foundation.mdc"),
  );
  const functionalIndexTemplate = await readKnowledgeBase(
    path.join("functional", "index.mdc"),
  );
  const technicalIndexTemplate = await readKnowledgeBase(
    path.join("technical", "index.mdc"),
  );
  const aiMetaIndexTemplate = await readKnowledgeBase(
    path.join("ai-meta", "index.mdc"),
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
    path.join(persistencyPath, "functional", "index.mdc"),
    functionalIndexTemplate,
    force,
  );
  await safeWriteFile(
    path.join(persistencyPath, "technical", "foundation.mdc"),
    technical,
    force,
  );
  await safeWriteFile(
    path.join(persistencyPath, "technical", "index.mdc"),
    technicalIndexTemplate,
    force,
  );
  await safeWriteFile(
    path.join(persistencyPath, "ai-meta", "foundation.mdc"),
    aiMeta,
    force,
  );
  await safeWriteFile(
    path.join(persistencyPath, "ai-meta", "index.mdc"),
    aiMetaIndexTemplate,
    force,
  );
}

function bulletList(items: string[], emptyFallback: string): string {
  if (!items.length) return emptyFallback;
  return items.map((item) => `- ${item}`).join("\n");
}

export async function writeMigrationBrief(
  persistencyPath: string,
  context: {
    projectName: string;
    agent: string;
    existingLayer: string;
    sources: string[];
    intakeNotes: string;
    referencedExtras: string[];
    unreferencedExtras: string[];
    missingCanonicalDirs: string[];
  },
): Promise<void> {
  const manifestPath = path.join(persistencyPath, "ai-meta", "migration-brief.mdc");
  const template = await readKnowledgeBase(
    path.join("ai-meta", "migration-brief.mdc"),
  );

  const uniqueSources = Array.from(new Set(context.sources));
  const list = bulletList(uniqueSources, "- _(no additional sources detected)_");

  const notes = context.intakeNotes.length
    ? bulletList(
        context.intakeNotes
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
        "- _(no supplemental notes provided)_",
      )
    : "- _(no supplemental notes provided)_";

  const referenced = bulletList(
    context.referencedExtras,
    "- _(none detected)_",
  );
  const unreferenced = bulletList(
    context.unreferencedExtras,
    "- _(none detected)_",
  );
  const missingCanonical = bulletList(
    context.missingCanonicalDirs,
    "- _(all canonical domains existed prior to migration)_",
  );

  const content = template
    .replace(/{{projectName}}/g, context.projectName)
    .replace(/{{agent}}/g, context.agent)
    .replace(/{{existingLayer}}/g, context.existingLayer)
    .replace("{{sourcesList}}", list)
    .replace("{{intakeNotes}}", notes)
    .replace("{{referencedExtras}}", referenced)
    .replace("{{unreferencedExtras}}", unreferenced)
    .replace("{{missingCanonical}}", missingCanonical);

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
    `CONFIG_FILE="$SCRIPT_DIR/${DEFAULT_CONFIG_FILE}"`,
    "",
    'if [[ -f "$CONFIG_FILE" ]]; then',
    "  set -a",
    "  # shellcheck disable=SC1090",
    '  source "$CONFIG_FILE"',
    "  set +a",
    "fi",
    "",
    'if [[ -n "${PROJECT_PATH:-}" ]]; then',
    '  PROJECT_ROOT="$(cd "${PROJECT_PATH}" && pwd)"',
    "else",
    '  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"',
    "fi",
    "",
    `PROMPT_FILE="$PROJECT_ROOT/${UPSERT_PROMPT_FILE}"`,
    "",
    'export PROJECT_PERSISTENCY_DIR="$SCRIPT_DIR"',
    'export PROJECT_PERSISTENCY_FUNCTIONAL="$SCRIPT_DIR/functional"',
    'export PROJECT_PERSISTENCY_TECHNICAL="$SCRIPT_DIR/technical"',
    'export PROJECT_PERSISTENCY_AI_META="$SCRIPT_DIR/ai-meta"',
    'export PROJECT_PERSISTENCY_ASSETS="$SCRIPT_DIR/ai-meta/assets"',
    'export PROJECT_PERSISTENCY_ROOT="$PROJECT_ROOT"',
    'export PROJECT_PERSISTENCY_PROMPT="$PROMPT_FILE"',
    "",
    `DEFAULT_AI_CMD=${JSON.stringify(aiCmd)}`,
    'TARGET_AI_CMD="${AI_CMD:-$DEFAULT_AI_CMD}"',
    'FORWARD_ARGS=("$@")',
    "",
    'if [[ ! -f "$PROMPT_FILE" ]]; then',
    '  echo "Warning: missing migration prompt at $PROMPT_FILE" >&2',
    '  exec "$TARGET_AI_CMD" "${FORWARD_ARGS[@]}"',
    "fi",
    "",
    'PROMPT_CONTENT="$(cat "$PROMPT_FILE")"',
    'printf -v PROMPT_PAYLOAD "%s\\n" "$PROMPT_CONTENT"',
    'if [[ -n "${TITLE:-}" ]]; then',
    '  printf -v PROMPT_PAYLOAD "# Conversation Title: %s\\n\\n%s" "$TITLE" "$PROMPT_PAYLOAD"',
    "fi",
    "",
    'echo "Streaming migration prompt from $PROMPT_FILE" >&2',
    'exec "$TARGET_AI_CMD" "${FORWARD_ARGS[@]}" "$PROMPT_PAYLOAD"',
    "",
  ].join("\n");

  const startPath = path.join(persistencyPath, DEFAULT_START_SCRIPT);
  await safeWriteFile(startPath, script, true);
  try {
    await fs.chmod(startPath, 0o755);
  } catch (error) {
    console.warn(
      chalk.yellow(
        `Warning: unable to mark ${startPath} as executable automatically: ${String(error)}`,
      ),
    );
  }
}

export async function writeUpsertScript(
  persistencyPath: string,
  aiCmd: string,
  force: boolean,
): Promise<void> {
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    `CONFIG_FILE="$SCRIPT_DIR/${DEFAULT_CONFIG_FILE}"`,
    "",
    'if [[ -f "$CONFIG_FILE" ]]; then',
    "  set -a",
    "  # shellcheck disable=SC1090",
    '  source "$CONFIG_FILE"',
    "  set +a",
    "fi",
    "",
    'if [[ -n "${PROJECT_PATH:-}" ]]; then',
    '  PROJECT_ROOT="$(cd "${PROJECT_PATH}" && pwd)"',
    "else",
    '  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"',
    "fi",
    "",
    `PROMPT_FILE="$PROJECT_ROOT/${UPSERT_PROMPT_FILE}"`,
    "",
    'export PROJECT_PERSISTENCY_DIR="$SCRIPT_DIR"',
    'export PROJECT_PERSISTENCY_FUNCTIONAL="$SCRIPT_DIR/functional"',
    'export PROJECT_PERSISTENCY_TECHNICAL="$SCRIPT_DIR/technical"',
    'export PROJECT_PERSISTENCY_AI_META="$SCRIPT_DIR/ai-meta"',
    'export PROJECT_PERSISTENCY_ASSETS="$SCRIPT_DIR/ai-meta/assets"',
    'export PROJECT_PERSISTENCY_ROOT="$PROJECT_ROOT"',
    'export PROJECT_PERSISTENCY_PROMPT="$PROMPT_FILE"',
    "",
    `DEFAULT_AI_CMD=${JSON.stringify(aiCmd)}`,
    'TARGET_AI_CMD="${AI_CMD:-$DEFAULT_AI_CMD}"',
    'FORWARD_ARGS=("$@")',
    "",
    'if [[ ! -f "$PROMPT_FILE" ]]; then',
    '  echo "Error: missing migration prompt at $PROMPT_FILE" >&2',
    "  exit 1",
    "fi",
    "",
    'PROMPT_CONTENT="$(cat "$PROMPT_FILE")"',
    'printf -v PROMPT_PAYLOAD "%s\\n" "$PROMPT_CONTENT"',
    'if [[ -n "${TITLE:-}" ]]; then',
    '  printf -v PROMPT_PAYLOAD "# Conversation Title: %s\\n\\n%s" "$TITLE" "$PROMPT_PAYLOAD"',
    "fi",
    "",
    'echo "Streaming upsert prompt from $PROMPT_FILE" >&2',
    'exec "$TARGET_AI_CMD" "${FORWARD_ARGS[@]}" "$PROMPT_PAYLOAD"',
    "",
  ].join("\n");

  const upsertPath = path.join(persistencyPath, DEFAULT_UPSERT_SCRIPT);
  await safeWriteFile(upsertPath, script, true);
  try {
    await fs.chmod(upsertPath, 0o755);
  } catch (error) {
    console.warn(
      chalk.yellow(
        `Warning: unable to mark ${upsertPath} as executable automatically: ${String(error)}`,
      ),
    );
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
  projectPath: string,
  persistencyPath: string,
  metadata: PersistencyMetadata,
): Promise<void> {
  const metaPath = path.join(persistencyPath, PERSISTENCY_METADATA_FILE);
  await safeWriteFile(metaPath, JSON.stringify(metadata, null, 2), true);

  const pointerValue =
    metadata.persistencyDir && metadata.persistencyDir.length
      ? metadata.persistencyDir
      : path.relative(projectPath, persistencyPath);
  const pointerPath = path.join(projectPath, PERSISTENCY_POINTER_FILE);
  await fs.writeFile(pointerPath, `${pointerValue}\n`, "utf8");
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

  const checkTemplate = await readResource("anti-drift/check-stale.ts.int");
  const refreshTemplate = await readResource(
    "anti-drift/refresh-layer.ts.int",
  );

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

export async function writeUpsertPrompt(
  projectPath: string,
  persistencyRelDir: string,
  context: {
    projectName: string;
    agent: string;
    layout: LayoutAnalysis;
    intakeNotes: string;
    migrationBriefRelPath: string;
  },
): Promise<string> {
  const template = await readResource("prompts/upsert-session.prompt.mdc");

  const canonicalPaths = CANONICAL_DOMAIN_DIRS.map(
    (dir) => `- ${persistencyRelDir}/${dir}`,
  ).join("\n");

  const referencedExtras = bulletList(
    context.layout.referencedExtras.map((dir) => `${persistencyRelDir}/${dir}`),
    "- _(none detected)_",
  );
  const unreferencedExtras = bulletList(
    context.layout.unreferencedExtras.map((dir) => `${persistencyRelDir}/${dir}`),
    "- _(none detected)_",
  );
  const missingCanonical = bulletList(
    context.layout.missingCanonicalDirs,
    "- _(all canonical domains already existed)_",
  );
  const intakeNotes = context.intakeNotes.length
    ? bulletList(
        context.intakeNotes
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
        "- _(no supplemental notes provided)_",
      )
    : "- _(no supplemental notes provided)_";

  const existingExtras = bulletList(
    context.layout.extraDirectories.map((dir) => `${persistencyRelDir}/${dir}`),
    "- _(none detected)_",
  );

  const migrationBriefRef =
    context.migrationBriefRelPath.length > 0
      ? context.migrationBriefRelPath
      : path.join(persistencyRelDir, "ai-meta", "migration-brief.mdc");

  const content = template
    .replace(/{{projectName}}/g, context.projectName)
    .replace(/{{agent}}/g, context.agent)
    .replace(/{{persistencyDir}}/g, persistencyRelDir)
    .replace(/{{canonicalPaths}}/g, canonicalPaths)
    .replace(/{{existingExtras}}/g, existingExtras)
    .replace(/{{referencedExtras}}/g, referencedExtras)
    .replace(/{{unreferencedExtras}}/g, unreferencedExtras)
    .replace(/{{missingCanonical}}/g, missingCanonical)
    .replace(/{{intakeNotes}}/g, intakeNotes)
    .replace(/{{migrationBrief}}/g, migrationBriefRef);

  const promptPath = path.join(projectPath, UPSERT_PROMPT_FILE);
  await safeWriteFile(promptPath, content, true);
  return promptPath;
}
