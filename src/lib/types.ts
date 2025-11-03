import type { SupportedAgent } from "./constants.js";

export interface CliFlags {
  projectName?: string;
  projectPath?: string;
  persistencyDir: string;
  persistencyDirProvided?: boolean;
  prevLayer?: string;
  prodBranch?: string;
  agent?: SupportedAgent;
  aiCmd?: string;
  defaultModel?: string;
  assets: string[];
  intakeNotes?: string;
  force: boolean;
  keepBackup: boolean;
  logHistory: boolean;
}

export interface ResolvedOptions extends CliFlags {
  projectName: string;
  projectPath: string;
  prodBranch: string;
  agent: SupportedAgent;
  aiCmd: string;
  intakeNotes: string;
}

export interface AntiDriftMetrics {
  daysSinceUpdate: number;
  commitsSinceTruth: number;
}
