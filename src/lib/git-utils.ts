import path from "node:path";
import { promises as fs } from "node:fs";
import { simpleGit, type SimpleGit } from "simple-git";
import dayjs from "dayjs";
import { EXIT_CODES } from "./constants.js";

export class GitRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitRepoError";
  }
}

export interface FreshnessMetrics {
  daysSinceUpdate: number;
  commitsSinceTruth: number;
}

export async function ensureGitRepo(projectPath: string): Promise<SimpleGit> {
  const git = simpleGit({ baseDir: projectPath });
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new GitRepoError(
      `Directory ${projectPath} is not a Git repository.`,
    );
  }
  return git;
}

export async function getCurrentBranch(git: SimpleGit): Promise<string> {
  const status = await git.status();
  return status.current ?? "HEAD";
}

export async function resolveTruthBranch(
  git: SimpleGit,
  preferred?: string,
): Promise<string> {
  if (preferred) {
    const branches = await git.branch();
    if (branches.all.includes(preferred)) {
      return preferred;
    }
  }
  return getCurrentBranch(git);
}

export async function getCommitDistanceFromTruth(
  git: SimpleGit,
  truthBranch: string,
): Promise<number> {
  try {
    const raw = await git.raw(["rev-list", "--count", `${truthBranch}..HEAD`]);
    return Number.parseInt(raw.trim(), 10) || 0;
  } catch (error) {
    if (truthBranch === "HEAD") return 0;
    throw error;
  }
}

export async function getBranchCommit(
  git: SimpleGit,
  branch: string,
): Promise<string> {
  return (await git.revparse([branch])).trim();
}

export async function computeFreshnessMetrics(
  persistencyPath: string,
  metadataPath: string,
  commitsSinceTruth: number,
): Promise<FreshnessMetrics> {
  try {
    const metadataRaw = await fs.readFile(metadataPath, "utf8");
    const metadata = JSON.parse(metadataRaw) as { updatedAt?: string };
    if (metadata.updatedAt) {
      const updatedAt = dayjs(metadata.updatedAt);
      const daysSinceUpdate = Math.max(dayjs().diff(updatedAt, "day"), 0);
      return { daysSinceUpdate, commitsSinceTruth };
    }
  } catch {
    // ignore missing metadata
  }
  return { daysSinceUpdate: 0, commitsSinceTruth };
}

export async function readGitIgnore(baseDir: string): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(baseDir, ".gitignore"), "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function exitWithCode(code: number, message?: string): never {
  if (message) {
    console.error(message);
  }
  process.exit(code);
}
