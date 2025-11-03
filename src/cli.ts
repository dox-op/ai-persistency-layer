import path from "node:path";
import process from "node:process";
import { promises as fs } from "node:fs";
import { Command, Option } from "commander";
import chalk from "chalk";
import ora from "ora";
import dayjs from "dayjs";
import {
  DEFAULT_PERSISTENCY_DIR,
  DEFAULT_SNAPSHOT_DIR,
  DEFAULT_LOG_FILE,
  EXIT_CODES,
  SUPPORTED_AGENTS,
  type PersistencyMetadata,
} from "./lib/constants.js";
import type { CliFlags, ResolvedOptions } from "./lib/types.js";
import { promptForMissingOptions } from "./lib/prompts.js";
import {
  ensureAgentCli,
  ensureAgentAuth,
} from "./lib/ai-install.js";
import {
  ensureGitRepo,
  resolveTruthBranch,
  captureSnapshot,
  writeSnapshotFile,
  getCommitDistanceFromTruth,
  GitRepoError,
} from "./lib/git-utils.js";
import {
  ensureBaseLayout,
  backupExistingLayer,
  copyAssets,
  writeBootstrap,
  writeDomainFoundations,
  writeConfigEnv,
  writeStartScript,
  writeLogEntry,
  writeMetadata,
  writeAntiDriftScripts,
  writeLegacyImportManifest,
} from "./lib/fs-utils.js";

async function readExistingMetadata(metaPath: string): Promise<PersistencyMetadata | undefined> {
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    return JSON.parse(raw) as PersistencyMetadata;
  } catch {
    return undefined;
  }
}

async function applyMetadataDefaults(flags: CliFlags): Promise<CliFlags> {
  const baseProjectPath = path.resolve(flags.projectPath ?? process.cwd());
  const candidatePersistencyDir = flags.persistencyDir ?? DEFAULT_PERSISTENCY_DIR;
  const candidatePersistencyPath = path.isAbsolute(candidatePersistencyDir)
    ? candidatePersistencyDir
    : path.join(baseProjectPath, candidatePersistencyDir);
  const directMetaPath = path.join(baseProjectPath, ".persistency-meta.json");
  const metadataCandidates = [
    path.join(candidatePersistencyPath, ".persistency-meta.json"),
    directMetaPath,
  ];

  let metadata: PersistencyMetadata | undefined;
  for (const candidate of metadataCandidates) {
    metadata = await readExistingMetadata(candidate);
    if (metadata) break;
  }
  if (!metadata) {
    return flags;
  }

  const nextFlags: CliFlags = {
    ...flags,
    projectName: flags.projectName ?? metadata.projectName,
    projectPath: flags.projectPath ?? metadata.projectPath,
    prodBranch: flags.prodBranch ?? metadata.prodBranch,
    agent: flags.agent ?? metadata.agent,
    defaultModel: flags.defaultModel ?? metadata.defaultModel,
    persistencyDir: metadata.persistencyDir ?? flags.persistencyDir,
    assets: flags.assets ?? [],
  };

  if (!nextFlags.installMethod) {
    const installMethod = metadata.installMethod;
    if (
      installMethod === "pnpm" ||
      installMethod === "npm" ||
      installMethod === "brew" ||
      installMethod === "pipx" ||
      installMethod === "skip"
    ) {
      nextFlags.installMethod = installMethod;
    }
  }

  return nextFlags;
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
      DEFAULT_PERSISTENCY_DIR,
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
    .addOption(
      new Option(
        "--install-method <method>",
        "Install or update the AI CLI.",
      ).choices(["pnpm", "npm", "brew", "pipx", "skip"]),
    )
    .option("--default-model <string>", "Default AI model identifier.")
    .option("--write-config", "Write persistency.config.env and anti-drift scripts.", false)
    .option("--asset <path>", "Additional asset to include.", collect, [])
    .option("--non-interactive", "Fail if required inputs are missing.", false)
    .option("--yes", "Assume yes for confirmations.", false)
    .option("--force", "Overwrite existing files.", false)
    .option("--keep-backup", "Retain a backup of the existing persistency layer.", false)
    .option("--log-history", "Append to _bootstrap.log with refresh details.", false)
    .option("--start-session", "Immediately start an AI session after bootstrap.", false)
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
  const defaults: CliFlags = {
    persistencyDir: DEFAULT_PERSISTENCY_DIR,
    assets: [] as string[],
    writeConfig: false,
    nonInteractive: false,
    yes: false,
    force: false,
    keepBackup: false,
    logHistory: false,
    startSession: false,
  };
  const flags: CliFlags = {
    ...defaults,
    ...rawOpts,
  };
  const hydratedFlags = await applyMetadataDefaults(flags);
  const options = await promptForMissingOptions({
    ...hydratedFlags,
    assets: hydratedFlags.assets ?? [],
  });

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
    ".persistency-meta.json",
  );
  const previousMetadata = await readExistingMetadata(existingMetadataPath);

  const daysSinceUpdate = previousMetadata?.updatedAt
    ? Math.max(dayjs().diff(dayjs(previousMetadata.updatedAt), "day"), 0)
    : 0;

  const aiCmd = await ensureAgentCli(
    options.agent,
    options.installMethod,
    options.aiCmd,
  );
  await ensureAgentAuth(options.agent, aiCmd);

  const spinner = ora("Preparing AI persistency layer...").start();
  const legacySources: string[] = [];

  if (!options.force && options.keepBackup) {
    const backupPath = await backupExistingLayer(persistencyPath, projectPath);
    if (backupPath) {
      spinner.info(`Existing layer backed up to ${backupPath}`);
      legacySources.push(path.relative(projectPath, backupPath));
      spinner.start();
    }
  }

  await fs.rm(persistencyPath, { recursive: true, force: true });
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
  const snapshot = await captureSnapshot(git, truthBranch);
  const snapshotPath = await writeSnapshotFile(
    snapshot,
    persistencyPath,
    DEFAULT_SNAPSHOT_DIR,
  );

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
    path.relative(projectPath, snapshotPath),
    options.force,
  );

  if (options.writeConfig || options.yes) {
    await writeConfigEnv(options, persistencyPath, options.force, aiCmd);
    await writeAntiDriftScripts(
      projectPath,
      path.relative(projectPath, persistencyPath),
      options.force,
    );
  }

  await writeStartScript(persistencyPath, aiCmd, options.force);
  await writeLegacyImportManifest(
    persistencyPath,
    legacySources,
  );

  const metadata: PersistencyMetadata = {
    projectName: options.projectName,
    projectPath,
    agent: options.agent,
    defaultModel: options.defaultModel,
    persistencyDir: path.relative(projectPath, persistencyPath),
    prodBranch: truthBranch,
    snapshotRef: snapshot.commit,
    updatedAt: dayjs().toISOString(),
    installMethod: options.installMethod,
    assets: copiedAssets.map((assetPath) => path.relative(projectPath, assetPath)),
    legacySources: legacySources.length
      ? legacySources
      : undefined,
    freshness: metrics,
  };

  await writeMetadata(persistencyPath, metadata);

  if (options.logHistory) {
    await writeLogEntry(
      persistencyPath,
      `Refreshed by ai-persistency-layer on ${truthBranch} (commit ${snapshot.commit.slice(0, 7)})`,
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

  spinner.succeed("AI persistency layer ready.");

  console.log(chalk.green(`Persistency directory: ${persistencyPath}`));
  console.log(chalk.green(`Snapshot stored in: ${snapshotPath}`));

  if (options.startSession || (!options.nonInteractive && !options.yes)) {
    try {
      const answer = await import("inquirer").then((mod) =>
        mod.default.prompt([
          {
            name: "startNow",
            type: "confirm",
            message: `Start ${options.agent} session now?`,
            default: false,
          },
        ]),
      );
      if (answer.startNow) {
        console.log(chalk.cyan(`Launching ${options.agent} via ai-start.sh...`));
        const startScript = path.join(persistencyPath, "ai-start.sh");
        await (await import("execa")).execa(startScript, {
          stdio: "inherit",
        });
      }
    } catch (error) {
      console.warn(
        chalk.yellow(
          `Unable to offer start session prompt: ${String(error)}`,
        ),
      );
    }
  }

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
