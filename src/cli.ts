import path from "node:path";
import process from "node:process";
import { promises as fs } from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import dayjs from "dayjs";
import {
  DEFAULT_PERSISTENCY_DIR,
  DEFAULT_LOG_FILE,
  DEFAULT_START_SCRIPT,
  DEFAULT_UPSERT_SCRIPT,
  EXIT_CODES,
  SUPPORTED_AGENTS,
  PERSISTENCY_METADATA_FILE,
  PERSISTENCY_POINTER_FILE,
  type PersistencyMetadata,
} from "./lib/constants.js";
import type { CliFlags, ResolvedOptions } from "./lib/types.js";
import {
  ensureGitRepo,
  resolveTruthBranch,
  getBranchCommit,
  getCommitDistanceFromTruth,
  GitRepoError,
} from "./lib/git-utils.js";
import {
  ensureBaseLayout,
  backupExistingLayer,
  copyAssets,
  analyzePersistencyLayout,
  writeBootstrap,
  writeDomainFoundations,
  writeConfigEnv,
  writeStartScript,
  writeUpsertScript,
  writeLogEntry,
  writeMetadata,
  writeAntiDriftScripts,
  writeMigrationBrief,
  writeUpsertPrompt,
} from "./lib/fs-utils.js";

async function readExistingMetadata(metaPath: string): Promise<PersistencyMetadata | undefined> {
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    return JSON.parse(raw) as PersistencyMetadata;
  } catch {
    return undefined;
  }
}

async function readPersistencyPointer(
  projectPath: string,
): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(
      path.join(projectPath, PERSISTENCY_POINTER_FILE),
      "utf8",
    );
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

interface MetadataResolution {
  flags: CliFlags;
  metadataFound: boolean;
  projectPath: string;
}

async function applyMetadataDefaults(flags: CliFlags): Promise<MetadataResolution> {
  const baseProjectPath = path.resolve(flags.projectPath ?? process.cwd());
  const defaultPersistencyDir = flags.persistencyDir ?? DEFAULT_PERSISTENCY_DIR;
  const pointerDir = flags.persistencyDirProvided
    ? undefined
    : await readPersistencyPointer(baseProjectPath);
  const candidatePersistencyDir = flags.persistencyDirProvided
    ? defaultPersistencyDir
    : pointerDir ?? defaultPersistencyDir;
  const candidatePersistencyPath = path.isAbsolute(candidatePersistencyDir)
    ? candidatePersistencyDir
    : path.join(baseProjectPath, candidatePersistencyDir);
  const directMetaPath = path.join(baseProjectPath, PERSISTENCY_METADATA_FILE);
  const metadataCandidates = [
    path.join(candidatePersistencyPath, PERSISTENCY_METADATA_FILE),
    directMetaPath,
  ];

  let metadata: PersistencyMetadata | undefined;
  for (const candidate of metadataCandidates) {
    metadata = await readExistingMetadata(candidate);
    if (metadata) break;
  }

  const nextFlags: CliFlags = {
    ...flags,
    persistencyDir: metadata?.persistencyDir ?? candidatePersistencyDir,
  };

  if (metadata) {
    nextFlags.projectName = nextFlags.projectName ?? metadata.projectName;
    nextFlags.projectPath = nextFlags.projectPath ?? metadata.projectPath;
    nextFlags.prodBranch = nextFlags.prodBranch ?? metadata.prodBranch;
    nextFlags.agent = nextFlags.agent ?? metadata.agent;
    nextFlags.defaultModel =
      nextFlags.defaultModel ?? metadata.defaultModel;
    nextFlags.intakeNotes =
      nextFlags.intakeNotes ?? metadata.intakeNotes;

  }

  if (!Array.isArray(nextFlags.assets)) {
    nextFlags.assets = [];
  }

  nextFlags.projectPath = nextFlags.projectPath ?? baseProjectPath;

  return {
    flags: nextFlags,
    metadataFound: Boolean(metadata),
    projectPath: baseProjectPath,
  };
}

async function inferProjectName(projectPath: string, fallback?: string): Promise<string> {
  if (fallback && fallback.trim().length) {
    return fallback.trim();
  }

  try {
    const packageJsonPath = path.join(projectPath, "package.json");
    const contents = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(contents);
    if (parsed && typeof parsed.name === "string" && parsed.name.trim().length) {
      return parsed.name.trim();
    }
  } catch {
    // ignore missing package.json or malformed file
  }

  return path.basename(projectPath);
}

async function resolveOptions(flags: CliFlags): Promise<ResolvedOptions> {
  const projectPath = path.resolve(flags.projectPath ?? process.cwd());
  const persistencyDir = flags.persistencyDir ?? DEFAULT_PERSISTENCY_DIR;
  const projectName = await inferProjectName(projectPath, flags.projectName);
  const agent = flags.agent ?? SUPPORTED_AGENTS[0];
  const aiCmd =
    flags.aiCmd && flags.aiCmd.trim().length
      ? flags.aiCmd.trim()
      : agent;

  return {
    ...flags,
    persistencyDir,
    projectName,
    projectPath,
    prodBranch: flags.prodBranch ?? "",
    agent,
    aiCmd,
    intakeNotes: flags.intakeNotes?.trim() ?? "",
    assets: flags.assets ?? [],
  };
}

function buildProgram(): Command {
  const program = new Command("ai-persistency-layer");
  program
    .description("Bootstrap or refresh an AI persistency layer inside a Git repository.")
    .option("--project-name <string>", "Project name.")
    .option("--project-path <path>", "Path to the project repository.")
    .option(
      "--persistency-dir <path>",
      "Directory of the AI persistency layer.",
    )
    .option("--prev-layer <path>", "Previous persistency layer to import.")
    .option(
      "--prod-branch <branch>",
      "Production (truth) branch. Defaults to current branch.",
    )
    .option(
      "--agent <agent>",
      `AI agent CLI to use (${SUPPORTED_AGENTS.join(", ")}).`,
    )
    .option("--ai-cmd <cmd>", "Explicit AI CLI command or path.")
    .option("--default-model <string>", "Default AI model identifier.")
    .option("--asset <path>", "Additional asset to include.", collect, [])
    .option(
      "--intake-notes <text>",
      "Comma-separated notes or references to supplemental documentation (CSV exports, Confluence paths, etc.).",
    )
    .option("--force", "Overwrite existing files.", false)
    .option("--keep-backup", "Retain a backup of the existing persistency layer.", false)
    .option("--log-history", "Append to _bootstrap.log with refresh details.", false)
    .allowUnknownOption(false)
    .showHelpAfterError();
  return program;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function run(): Promise<void> {
  const overrideProjectPath = process.env.APL_TEST_TARGET;
  const program = buildProgram();
  const parsed = program.parse(process.argv);

  const rawOpts = parsed.opts<CliFlags>();
  const persistencyDirSource = typeof parsed.getOptionValueSource === "function"
    ? parsed.getOptionValueSource("persistencyDir")
    : undefined;
  const persistencyDirProvided =
    persistencyDirSource !== undefined && persistencyDirSource !== "default";
  const defaults: CliFlags = {
    persistencyDir: DEFAULT_PERSISTENCY_DIR,
    persistencyDirProvided: false,
    assets: [] as string[],
    force: false,
    keepBackup: false,
    logHistory: false,
  };
  const flags: CliFlags = {
    ...defaults,
    ...rawOpts,
    persistencyDirProvided,
  };
  let { flags: hydratedFlags } = await applyMetadataDefaults(flags);

  if (overrideProjectPath) {
    hydratedFlags.projectPath = overrideProjectPath;
  }

  const options = await resolveOptions(hydratedFlags);

  const projectPath = overrideProjectPath
    ? path.resolve(overrideProjectPath)
    : path.resolve(options.projectPath ?? process.cwd());
  options.projectPath = projectPath;

  const persistencyPath = path.resolve(
    projectPath,
    options.persistencyDir ?? DEFAULT_PERSISTENCY_DIR,
  );

  const git = await ensureGitRepo(projectPath);
  const truthBranch = await resolveTruthBranch(git, options.prodBranch);
  options.prodBranch = truthBranch;

  const existingMetadataPath = path.join(
    persistencyPath,
    PERSISTENCY_METADATA_FILE,
  );
  const previousMetadata = await readExistingMetadata(existingMetadataPath);

  const daysSinceUpdate = previousMetadata?.updatedAt
    ? Math.max(dayjs().diff(dayjs(previousMetadata.updatedAt), "day"), 0)
    : 0;

  const aiCmd = options.aiCmd.length ? options.aiCmd : options.agent;

  const layoutSnapshot = await analyzePersistencyLayout(persistencyPath);

  const spinner = ora("Preparing AI persistency layer migration...").start();
  const legacySources: string[] = [
    path.relative(projectPath, persistencyPath) || ".",
  ];

  if (!options.force && options.keepBackup) {
    const backupPath = await backupExistingLayer(persistencyPath, projectPath);
    if (backupPath) {
      spinner.info(`Existing layer backed up to ${backupPath}`);
      legacySources.push(path.relative(projectPath, backupPath));
      spinner.start();
    }
  }

  await ensureBaseLayout(persistencyPath);

  if (options.prevLayer) {
    try {
      const prev = path.resolve(options.prevLayer);
      await fs.access(prev);
      const legacyDir = path.join(
        persistencyPath,
        "ai-meta",
        "legacy",
        dayjs().format("YYYYMMDD-HHmmss"),
      );
      await fs.mkdir(legacyDir, { recursive: true });
      await fs.cp(prev, legacyDir, { recursive: true });
      legacySources.push(path.relative(projectPath, legacyDir));
      spinner.info(`Staged previous layer at ${legacyDir}`);
      spinner.start();
    } catch (error) {
      spinner.warn(
        chalk.yellow(
          `Unable to import previous layer from ${options.prevLayer}: ${String(error)}`,
        ),
      );
      spinner.start();
    }
  }

  const copiedAssets = await copyAssets(options.assets, persistencyPath);
  const truthCommit = await getBranchCommit(git, truthBranch);

  const commitsSinceTruth = await getCommitDistanceFromTruth(git, truthBranch);
  const metrics = {
    daysSinceUpdate,
    commitsSinceTruth,
  };

  await writeDomainFoundations(options, persistencyPath, options.force);
  await writeBootstrap(
    options,
    persistencyPath,
    metrics,
    truthBranch,
    truthCommit,
    options.force,
  );

  await writeConfigEnv(options, persistencyPath, options.force, aiCmd);
  await writeAntiDriftScripts(
    projectPath,
    path.relative(projectPath, persistencyPath),
    options.force,
  );

  await writeStartScript(persistencyPath, aiCmd, options.force);
  await writeUpsertScript(persistencyPath, aiCmd, options.force);
  const existingLayerRel = path.relative(projectPath, persistencyPath) || ".";
  const migrationBriefFullPath = path.join(
    persistencyPath,
    "ai-meta",
    "migration-brief.mdc",
  );
  const migrationBriefRelPath = path.relative(projectPath, migrationBriefFullPath);
  await writeMigrationBrief(
    persistencyPath,
    {
      projectName: options.projectName,
      agent: options.agent,
      existingLayer: existingLayerRel,
      sources: legacySources.slice(1),
      intakeNotes: options.intakeNotes,
      referencedExtras: layoutSnapshot.referencedExtras,
      unreferencedExtras: layoutSnapshot.unreferencedExtras,
      missingCanonicalDirs: layoutSnapshot.missingCanonicalDirs,
    },
  );

  const upsertPromptPath = await writeUpsertPrompt(
    projectPath,
    existingLayerRel,
    {
      projectName: options.projectName,
      agent: options.agent,
      layout: layoutSnapshot,
      intakeNotes: options.intakeNotes,
      migrationBriefRelPath,
    },
  );

  const metadata: PersistencyMetadata = {
    projectName: options.projectName,
    projectPath,
    agent: options.agent,
    defaultModel: options.defaultModel,
    persistencyDir: path.relative(projectPath, persistencyPath),
    prodBranch: truthBranch,
    snapshotRef: truthCommit,
    updatedAt: dayjs().toISOString(),
    assets: copiedAssets.map((assetPath) => path.relative(projectPath, assetPath)),
    legacySources: legacySources.length > 1
      ? legacySources.slice(1)
      : undefined,
    intakeNotes: options.intakeNotes.length ? options.intakeNotes : undefined,
    freshness: metrics,
  };

  await writeMetadata(projectPath, persistencyPath, metadata);

  if (options.logHistory) {
    await writeLogEntry(
      persistencyPath,
      `Refreshed by ai-persistency-layer on ${truthBranch} (commit ${truthCommit.slice(0, 7)})`,
    );
    if (legacySources.length) {
      await writeLogEntry(
        persistencyPath,
        `Legacy sources to reconcile: ${legacySources.join(", ")}`,
      );
    }
  } else {
    await fs.rm(path.join(persistencyPath, DEFAULT_LOG_FILE), { force: true });
  }

  const migrationBriefPath = path.join(
    persistencyPath,
    "ai-meta",
    "migration-brief.mdc",
  );
  spinner.succeed("Migration brief prepared. Existing layer preserved.");

  console.log(chalk.green(`Persistency directory: ${persistencyPath}`));
  console.log(chalk.green(`Migration brief: ${migrationBriefPath}`));
  console.log(chalk.green(`Upsert prompt: ${upsertPromptPath}`));
  console.log(chalk.green(`Truth branch commit: ${truthCommit.slice(0, 7)}`));
  if (options.intakeNotes.length) {
    console.log(chalk.green("Supplemental notes captured in the brief."));
  }

  const startScriptPath = path.join(persistencyPath, DEFAULT_START_SCRIPT);
  const upsertScriptPath = path.join(persistencyPath, DEFAULT_UPSERT_SCRIPT);
  console.log(
    chalk.cyan(
      `Run ${startScriptPath} for an interactive agent session with the migration context.`,
    ),
  );
  console.log(
    chalk.cyan(
      `Run ${upsertScriptPath} to stream the upsert prompt in a one-shot session.`,
    ),
  );

  process.exitCode = EXIT_CODES.SUCCESS;
}

run().catch((error) => {
  if (error instanceof GitRepoError) {
    console.error(chalk.red(error.message));
    process.exit(EXIT_CODES.NOT_GIT_REPO);
  }

  if (typeof error?.message === "string") {
    const message = error.message;
    if (message.includes("Missing") && message.includes("CLI")) {
      console.error(chalk.red(message));
      process.exit(EXIT_CODES.AGENT_MISSING);
    }
    if (message.includes("authentication")) {
      console.error(chalk.red(message));
      process.exit(EXIT_CODES.AUTH_MISSING);
    }
    if (message.includes("Missing required")) {
      console.error(chalk.red(message));
      process.exit(EXIT_CODES.INVALID_ARGS);
    }
  }

  console.error(chalk.red("Unexpected error:"), error);
  process.exit(EXIT_CODES.GENERIC_FAILURE);
});
