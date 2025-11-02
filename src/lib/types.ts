import type { SupportedAgent } from "./constants.js";

export interface CliFlags {
  projectName?: string;
  projectPath?: string;
  persistencyDir: string;
  prevLayer?: string;
  prodBranch?: string;
  agent?: SupportedAgent;
  aiCmd?: string;
  installMethod?: "pnpm" | "npm" | "brew" | "pipx" | "skip";
  defaultModel?: string;
  writeConfig: boolean;
  assets: string[];
  nonInteractive: boolean;
  yes: boolean;
  force: boolean;
  keepBackup: boolean;
  logHistory: boolean;
  startSession: boolean;
}

export interface ResolvedOptions extends CliFlags {
  projectName: string;
  projectPath: string;
  prodBranch: string;
  agent: SupportedAgent;
  aiCmd: string;
}

export interface AntiDriftMetrics {
  daysSinceUpdate: number;
  commitsSinceTruth: number;
}
