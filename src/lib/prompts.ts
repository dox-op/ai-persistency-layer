import inquirer from "inquirer";
import path from "node:path";
import { SUPPORTED_AGENTS, type SupportedAgent } from "./constants.js";
import type { CliFlags, ResolvedOptions } from "./types.js";

export async function promptForMissingOptions(flags: CliFlags): Promise<ResolvedOptions> {
  if (flags.nonInteractive) {
    const missing: string[] = [];
    if (!flags.projectName) missing.push("--project-name");
    if (!flags.projectPath) missing.push("--project-path");
    if (!flags.agent) missing.push("--agent");
    if (missing.length) {
      throw new Error(
        `Missing required ${missing.join(", ")} in non-interactive mode.`,
      );
    }

    return {
      ...flags,
      projectName: flags.projectName!,
      projectPath: flags.projectPath!,
      agent: flags.agent!,
      aiCmd: flags.aiCmd ?? "",
      prodBranch: flags.prodBranch ?? "",
    };
  }

  const cwd = process.cwd();
  const questions: inquirer.QuestionCollection = [
    {
      name: "projectName",
      type: "input",
      message: "Project name:",
      default: flags.projectName ?? path.basename(cwd),
      when: !flags.projectName,
    },
    {
      name: "projectPath",
      type: "input",
      message: "Project path:",
      default: flags.projectPath ?? cwd,
      when: !flags.projectPath,
      filter: (value: string) => value.trim() || cwd,
    },
    {
      name: "persistencyDir",
      type: "input",
      message: "Persistency layer directory:",
      default: flags.persistencyDir,
      when: false,
    },
    {
      name: "prodBranch",
      type: "input",
      message: "Production (truth) branch:",
      default: flags.prodBranch,
      when: !flags.prodBranch,
    },
    {
      name: "agent",
      type: "list",
      message: "AI Agent CLI:",
      choices: SUPPORTED_AGENTS,
      default: flags.agent,
      when: !flags.agent,
    },
    {
      name: "aiCmd",
      type: "input",
      message: "AI CLI command (leave empty to auto-detect):",
      default: flags.aiCmd ?? "",
      when: !flags.aiCmd,
    },
    {
      name: "defaultModel",
      type: "input",
      message: "Default AI model identifier (optional):",
      default: flags.defaultModel,
      when: !flags.defaultModel,
    },
    {
      name: "assets",
      type: "input",
      message: "Additional assets (comma separated paths, optional):",
      when: !flags.assets.length,
      filter: (value: string) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
    },
  ];

  const answers = await inquirer.prompt(questions);

  const agent = (flags.agent ?? answers.agent) as SupportedAgent;

  return {
    ...flags,
    projectName: flags.projectName ?? answers.projectName,
    projectPath: flags.projectPath ?? answers.projectPath,
    prodBranch: flags.prodBranch ?? answers.prodBranch ?? "",
    agent,
    aiCmd: flags.aiCmd ?? answers.aiCmd ?? "",
    defaultModel: flags.defaultModel ?? answers.defaultModel ?? undefined,
    assets: flags.assets.length ? flags.assets : answers.assets ?? [],
  };
}
