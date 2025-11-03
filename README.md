# @dox-op/ai-persistency-layer

Refresh or reseed an AI Persistency Layer inside an existing Git repository.  
The tool mirrors the behaviour of the original `init-persistency-layer.sh` script while upgrading it to an idempotent TypeScript/ESM CLI that now requires an existing layer so migrations never start from a blank slate.

## Features

- Validates execution inside a Git repository (exit code `2` otherwise).
- Interactive prompts via Inquirer or fully headless operation with `--non-interactive`.
- Remembers previous runs by reading `.persistency-meta.json` and `.persistency-path`, reusing stored defaults without extra prompts.
- Detects, installs, or updates Codex, Claude, or Gemini CLIs using `execa`.
- Authenticates by checking standard environment variables and credential files (see “Authentication Requirements”).
- Generates knowledge-base scaffolding (bootstrap + per-domain foundations and indexes) from `src/lib/knowledge-base`.
- Always regenerates `ai-start.sh` and `ai-upsert.sh`, and—when run with `--write-config` or `--yes`—also writes `persistency.config.env` plus the anti-drift scripts sourced from `src/lib/resources`.
- Preserves the existing `ai/` layer and emits `ai-meta/migration-brief.mdc` so an agent can reconcile legacy and new rules.
- Generates a versioned upsert prompt (`persistency.upsert.prompt.mdc`) outside the layer so the chosen agent can apply changes consistently.
- Records the chosen truth branch commit and freshness metrics.

## Installation

- Run without installing:  
  ```bash
  npx @dox-op/ai-persistency-layer --agent claude --write-config --yes
  ```
- Install globally (optional):  
  ```bash
  npm install -g @dox-op/ai-persistency-layer
  # then
  ai-persistency-layer --agent claude --write-config --yes
  ```

## Usage

```bash
ai-persistency-layer [options]
```

| Option | Description |
| ------ | ----------- |
| `--project-name <string>` | Override project name (defaults to folder name). |
| `--project-path <path>` | Override project path (defaults to `cwd`). |
| `--persistency-dir <path>` | Destination directory (default: `ai`). |
| `--prev-layer <path>` | Import a previous persistency layer. |
| `--prod-branch <branch>` | Truth branch (defaults to current). |
| `--agent <codex|claude|gemini>` | Target AI agent CLI. |
| `--ai-cmd <cmd>` | Explicit agent command/binary (override PATH auto-detection). |
| `--install-method <pnpm|npm|brew|pipx|skip>` | Preferred installation strategy. |
| `--default-model <string>` | Default model identifier. |
| `--write-config` | Write `persistency.config.env` and anti-drift scripts. |
| `--asset <path>` | Extra asset to copy into the layer (repeatable). |
| `--intake-notes <text>` | Supplemental notes or document references injected into the migration brief. |
| `--non-interactive` | Fail instead of prompting for missing inputs. |
| `--yes` | Auto-confirm prompts (implies `--write-config`). |
| `--force` | Overwrite existing files. |
| `--keep-backup` | Retain the previous layer in `ai-backup/` before regenerating. |
| `--log-history` | Append refresh details to `_bootstrap.log` (default: off). |
| `-h, --help` | Display help. |

### Persistency directory discovery

The CLI looks for metadata in the `ai/` folder by default. If the
`.persistency-meta.json` file is not present there, you will be prompted once to
confirm where the existing layer lives. The selected directory is then recorded
in the project root via `.persistency-path`, allowing subsequent runs to reuse
the configured location without prompting again.

## Exit Codes

| Code | Meaning |
| ---- | ------- |
| `0` | Success |
| `1` | Generic failure |
| `2` | Not a git repository |
| `3` | Agent CLI missing |
| `4` | Authentication missing |
| `5` | Invalid arguments |

## Authentication Requirements

The CLI validates that the selected AI agent already has credentials configured.  
Set the appropriate environment variable (or equivalent config file) before running:

| Agent | Environment variables checked | Alternative credentials |
| ----- | ----------------------------- | ----------------------- |
| Codex | `CODEX_API_KEY`, `OPENAI_API_KEY` | `~/.config/codex/credentials`, `~/.codex/credentials` |
| Claude | `ANTHROPIC_API_KEY` | `~/.config/claude/credentials`, `~/.claude/credentials` |
| Gemini | `GOOGLE_API_KEY`, `GEMINI_API_KEY` | `~/.config/gemini/credentials`, `~/.gemini/credentials` |

If none of the variables exist and no credential file is found, the CLI checks whether the agent binary responds (for example, after running `codex login`). If it does, the tool proceeds with a warning; otherwise it exits with code `4` so you can complete the authentication.

## Local Development (contributors only)

```bash
pnpm install
pnpm dev        # tsx src/cli.ts
pnpm build      # tsc
```

Only run these commands when you are modifying the CLI locally.  
Before using `pnpm link --global`, run `pnpm build` once so the compiled `dist/` output is present. End users who install from npm do not need to build anything.

## Publishing (maintainers)

1. Install dependencies: `pnpm install`.
2. Build the distributable: `pnpm run build`.
3. Run the packaging smoke test: `pnpm run test:package` (ensures templates exist and the compiled CLI works end-to-end).
4. (Optional) Inspect the tarball with `npm pack`.
5. Publish: `npm publish --access public`.

Always run the build step before publishing so the `dist/` folder ships with the package.

## Anti-Drift Automation

When `--write-config` is supplied, the CLI generates:

- `scripts/ai/check-stale.ts` – validates freshness targets (7 days / 200 commits).
- `scripts/ai/refresh-layer.ts` – re-runs the bootstrap with `--yes`.

## Persistency Lifecycle

`ai-persistency-layer` sets up or refreshes the baseline; keeping it current requires a continuous workflow:

1. **Functional loop (BA/PO):** Use the generated layer as shared context for AI copilots or agents when preparing new tasks for the development team.
2. **Delivery loop (dev team):** Implement features and update the persistency layer as part of the Definition of Done, feeding new insights back into the `.mdc` files.
3. **Review loop (BA/PO):** Validate the updated layer, then start the next iteration by generating new tasks with the refreshed knowledge.

The CLI does not replace these feedback loops—it supplies the scaffolding that downstream processes must keep in sync.

## Migration Workflow

- The CLI refuses to run if the target persistency directory is missing (protects greenfield projects).
- When an existing layer is detected you must confirm the agent-assisted migration; no files are deleted or regenerated blindly.
- A migration brief is written to `ai-meta/migration-brief.mdc`, combining legacy sources, the enforced knowledge base rules (English-only, tri-domain separation, per-domain indexes), and any supplemental notes you supplied via `--intake-notes` or the shell script.
- Passing `--prev-layer <path>` stages that directory inside `ai-meta/legacy/<timestamp>` and records it as a source to reconcile in the migration brief.
- The CLI inspects existing directories before writing anything, flags additional folders (referenced vs non-referenced in the legacy bootstrap), and stores the outcome inside both the migration brief and the new `persistency.upsert.prompt.mdc`.
- Domain indexes (`functional/index.mdc`, `technical/index.mdc`, `ai-meta/index.mdc`) are created on first run and are expected to be maintained by agents afterwards.
- Use `ai-start.sh` to start the chosen agent, review the brief, and reconcile the layer.

### Handling Drift and Scale

This tool is not a silver bullet for AI-agent adoption; treat the suggestions below as starting points to tailor to your team:

- Track layer revisions with Git alongside application code.
- Split content by environment or domain to stay within context limits.
- Consider training dedicated LLMs or fine-tuned embeddings on the persistency layer so agents can reference large documents without re-ingesting every file.
- Schedule regular refreshes (automated or manual) to prevent the layer from diverging from the truth branch.

## Logging & Metadata

- `_bootstrap.log` (when `--log-history` is used) stores chronological activity.
- `.persistency-meta.json` tracks last refresh, truth branch commit, and freshness metrics.
- `.persistency-path` (at the repository root) stores the directory that contains the AI layer for future executions.
- `ai-meta/migration-brief.mdc` summarises the latest migration instructions for the agent.
- `persistency.upsert.prompt.mdc` (project root) captures the ready-to-run prompt for the selected agent, including supplemental notes and directory analysis.

## Start Script

`ai-start.sh` exports the tri-domain paths (`PROJECT_PERSISTENCY_FUNCTIONAL`, `PROJECT_PERSISTENCY_TECHNICAL`, `PROJECT_PERSISTENCY_AI_META`), loads `persistency.config.env` when present, and passes `persistency.upsert.prompt.mdc` (optionally prefixed with `$TITLE`) as the final argument to the selected AI CLI. The script `exec`s the agent, so it ends when the CLI exits. The CLI no longer auto-launches the agent; run the script yourself whenever you’re ready to review the migration brief with your copilot.

## Upsert Script

`ai-upsert.sh` streams the same prompt (passing it as the final argument) and exits once the agent finishes processing. Use it for one-shot alignments or CI jobs where you want the agent to ingest the migration instructions and report back in a single pass. Set `TITLE="My Session"` to prefix the streamed payload with a conversation title. Both scripts honour `AI_CMD` overrides from `persistency.config.env` and forward additional arguments to the agent CLI.

## FAQ

**What are the "anti-drift scripts"?**  
When you run the CLI with `--write-config`, it generates two scripts under `scripts/ai/`:
- `check-stale.ts` reads `.persistency-meta.json` and exits with a non-zero code if the layer breaches the default freshness SLO (7 days or 200 commits). It is designed for CI or scheduled tasks.
- `refresh-layer.ts` re-runs the bootstrap (`ai-persistency-layer --yes ...`), allowing you to schedule periodic regenerations or respond to drift alerts.

**Where do I store the settings that keep the layer idempotent?**  
The bootstrap creates `persistency.config.env` at the root of the layer. It captures the project name, reference paths, agent command, and the relative paths for the three domains. Extend it with your own variables or orchestration scripts if needed; the CLI regenerates or updates it on every run while keeping the configuration within the layer.
> If you skip `--ai-cmd`, the CLI searches the current `PATH` for the usual binary names (e.g. `codex`, `claude`, `gemini`). Specify a full path only when the executable lives elsewhere.
