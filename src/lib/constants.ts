export const DEFAULT_PERSISTENCY_DIR = "ai";
export const DEFAULT_LOG_FILE = "_bootstrap.log";
export const DEFAULT_BOOTSTRAP_FILE = "ai-bootstrap.mdc";
export const DEFAULT_CONFIG_FILE = "ai-config.env";
export const DEFAULT_START_SCRIPT = "ai-start.sh";
export const DEFAULT_SNAPSHOT_DIR = "technical/snapshots";
export const DEFAULT_ANTI_DRIFT_SLO_DAYS = 7;
export const DEFAULT_ANTI_DRIFT_SLO_COMMITS = 200;

export const SUPPORTED_AGENTS = ["codex", "claude", "gemini"] as const;
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC_FAILURE: 1,
  NOT_GIT_REPO: 2,
  AGENT_MISSING: 3,
  AUTH_MISSING: 4,
  INVALID_ARGS: 5
} as const;

export interface PersistencyMetadata {
  projectName: string;
  projectPath: string;
  agent: SupportedAgent;
  defaultModel?: string;
  persistencyDir: string;
  prodBranch: string;
  snapshotRef: string;
  updatedAt: string;
  installMethod?: string;
  assets?: string[];
  legacySources?: string[];
  freshness?: {
    daysSinceUpdate: number;
    commitsSinceTruth: number;
  };
}
