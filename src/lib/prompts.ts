import inquirer, { type QuestionCollection } from "inquirer";
import path from "node:path";
import { SUPPORTED_AGENTS, type SupportedAgent } from "./constants.js";
import { detectAgentBinary } from "./ai-install.js";
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
      intakeNotes: flags.intakeNotes?.trim() ?? "",
    };
  }

  const cwd = process.cwd();
  const questions: QuestionCollection = [
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
      when: !flags.persistencyDirProvided,
      filter: (value: string) => value.trim() || flags.persistencyDir,
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
      message: "AI CLI command override (optional full path or alias; press ENTER if the agent is already on PATH):",
      default: flags.aiCmd ?? "",
      when: async (answers) => {
        if (flags.aiCmd) return false;
        const agentCandidate = (flags.agent ?? answers.agent) as SupportedAgent | undefined;
        if (!agentCandidate) {
          return true;
        }
        const detected = await detectAgentBinary(agentCandidate);
        if (detected) {
          // Persist the detected path so downstream logic can reuse it without prompting again.
          (answers as Record<string, unknown>)._autoDetectedAiCmd = detected;
          return false;
        }
        return true;
      },
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
    {
      name: "intakeNotes",
      type: "input",
      message:
        "Supplemental notes or documentation sources (CSV exports, Confluence URLs, etc.):",
      when: typeof flags.intakeNotes === "undefined",
      filter: (value: string) => value.trim(),
    },
  ];

  const answers = await inquirer.prompt(questions);

  const agent = (flags.agent ?? answers.agent) as SupportedAgent;
  const autoDetectedAiCmd = (answers as Record<string, unknown>)._autoDetectedAiCmd as string | undefined;

  if (autoDetectedAiCmd && !flags.aiCmd && !answers.aiCmd) {
    // propagate detection so metadata/outputs can record the actual binary used
    answers.aiCmd = autoDetectedAiCmd;
  }

  return {
    ...flags,
    projectName: flags.projectName ?? answers.projectName,
    projectPath: flags.projectPath ?? answers.projectPath,
    prodBranch: flags.prodBranch ?? answers.prodBranch ?? "",
    agent,
    aiCmd: flags.aiCmd ?? answers.aiCmd ?? "",
    defaultModel: flags.defaultModel ?? answers.defaultModel ?? undefined,
    assets: flags.assets.length ? flags.assets : answers.assets ?? [],
    intakeNotes: (flags.intakeNotes ?? answers.intakeNotes ?? "").trim(),
  };
}

export async function promptForPersistencyDir(
  defaultDir: string,
): Promise<string> {
  const answer = await inquirer.prompt<{ persistencyDir?: string }>([
    {
      name: "persistencyDir",
      type: "input",
      message: "Where is the existing persistency layer?",
      default: defaultDir,
      filter: (value: string) => value.trim(),
    },
  ]);

  return answer.persistencyDir && answer.persistencyDir.length
    ? answer.persistencyDir
    : defaultDir;
}
