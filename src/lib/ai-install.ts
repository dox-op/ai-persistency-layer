import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { execa } from "execa";
import chalk from "chalk";
import ora from "ora";
import type { SupportedAgent } from "./constants.js";
import { EXIT_CODES } from "./constants.js";

const BINARY_CANDIDATES: Record<SupportedAgent, string[]> = {
  codex: ["codex", "codex-cli", "apl-codex"],
  claude: ["claude", "claude-cli"],
  gemini: ["gemini", "gemini-cli", "google-genai"],
};

const INSTALL_TARGETS: Record<
  SupportedAgent,
  {
    npm: string;
    pnpm: string;
    pipx: string;
    brew: string;
  }
> = {
  codex: {
    npm: "@vez/codex-cli",
    pnpm: "@vez/codex-cli",
    pipx: "codex-cli",
    brew: "codex-cli",
  },
  claude: {
    npm: "@anthropic-ai/claude-cli",
    pnpm: "@anthropic-ai/claude-cli",
    pipx: "anthropic-cli",
    brew: "anthropic-cli",
  },
  gemini: {
    npm: "@google/generative-ai-cli",
    pnpm: "@google/generative-ai-cli",
    pipx: "google-generativeai-cli",
    brew: "google-generativeai",
  },
};

const AUTH_HINTS: Record<SupportedAgent, string[]> = {
  codex: ["CODEX_API_KEY", "OPENAI_API_KEY"],
  claude: ["ANTHROPIC_API_KEY"],
  gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommand(binary: string): Promise<string | undefined> {
  if (binary.includes(path.sep)) {
    return (await pathExists(binary)) ? binary : undefined;
  }

  try {
    const { stdout } = await execa("bash", ["-lc", `command -v ${binary}`]);
    const resolved = stdout.trim();
    return resolved.length ? resolved : undefined;
  } catch {
    return undefined;
  }
}

async function findExistingBinary(
  agent: SupportedAgent,
  hint?: string,
): Promise<string | undefined> {
  if (hint) {
    const resolved = await resolveCommand(hint);
    if (resolved) return resolved;
  }

  for (const candidate of BINARY_CANDIDATES[agent]) {
    const resolved = await resolveCommand(candidate);
    if (resolved) return resolved;
  }

  return undefined;
}

async function installWithMethod(
  agent: SupportedAgent,
  method: "pnpm" | "npm" | "brew" | "pipx",
): Promise<void> {
  const spinner = ora(`Installing ${agent} CLI with ${method}...`).start();
  try {
    const target = INSTALL_TARGETS[agent][method];
    switch (method) {
      case "npm":
      case "pnpm": {
        await execa(method, ["install", "-g", target], { stdio: "inherit" });
        break;
      }
      case "pipx": {
        await execa("pipx", ["install", target], { stdio: "inherit" });
        break;
      }
      case "brew": {
        await execa("brew", ["install", target], { stdio: "inherit" });
        break;
      }
      default:
        throw new Error(`Unsupported install method: ${method}`);
    }
    spinner.succeed(`Installed ${agent} CLI via ${method}.`);
  } catch (error) {
    spinner.fail(`Failed to install ${agent} CLI with ${method}.`);
    throw error;
  }
}

async function updateWithMethod(
  agent: SupportedAgent,
  method: "pnpm" | "npm" | "brew" | "pipx",
): Promise<void> {
  const spinner = ora(`Updating ${agent} CLI with ${method}...`).start();
  try {
    const target = INSTALL_TARGETS[agent][method];
    switch (method) {
      case "npm":
      case "pnpm": {
        await execa(method, ["update", "-g", target], { stdio: "inherit" });
        break;
      }
      case "pipx": {
        await execa("pipx", ["upgrade", target], { stdio: "inherit" });
        break;
      }
      case "brew": {
        await execa("brew", ["upgrade", target], { stdio: "inherit" });
        break;
      }
      default:
        throw new Error(`Unsupported install method: ${method}`);
    }
    spinner.succeed(`Updated ${agent} CLI via ${method}.`);
  } catch (error) {
    spinner.fail(`Failed to update ${agent} CLI with ${method}.`);
    throw error;
  }
}

export async function ensureAgentCli(
  agent: SupportedAgent,
  installMethod: "pnpm" | "npm" | "brew" | "pipx" | "skip" | undefined,
  hint?: string,
): Promise<string> {
  const initial = await findExistingBinary(agent, hint);
  if (initial) {
    if (installMethod && installMethod !== "skip") {
      try {
        await updateWithMethod(agent, installMethod);
      } catch (error) {
        console.warn(
          chalk.yellow(
            `Warning: unable to update ${agent} CLI using ${installMethod}: ${String(error)}`,
          ),
        );
      }
    }
    return initial;
  }

  if (!installMethod || installMethod === "skip") {
    throw new Error(
      `Missing ${agent} CLI. Provide --install-method to install automatically or --ai-cmd to specify path.`,
    );
  }

  await installWithMethod(agent, installMethod);
  const resolved = await findExistingBinary(agent, hint);
  if (!resolved) {
    throw new Error(`Installed ${agent} CLI but command not found on PATH.`);
  }

  return resolved;
}

export async function ensureAgentAuth(agent: SupportedAgent): Promise<void> {
  const envVars = AUTH_HINTS[agent];
  const hasEnv = envVars.some((envVar) => Boolean(process.env[envVar]));
  if (hasEnv) {
    return;
  }

  const potentialConfigs = [
    path.join(os.homedir(), ".config", agent, "credentials"),
    path.join(os.homedir(), `.${agent}`, "credentials"),
  ];

  for (const candidate of potentialConfigs) {
    if (await pathExists(candidate)) {
      return;
    }
  }

  const prettyList = envVars.map((envVar) => `\`${envVar}\``).join(", ");
  throw new Error(
    `Missing authentication for ${agent} CLI. Ensure one of ${prettyList} is set or configure credentials.`,
  );
}
