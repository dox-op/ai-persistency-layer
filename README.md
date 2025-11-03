# @dox-op/ai-persistency-layer

## TL;DR for downstream devs
- Run `npx @dox-op/ai-persistency-layer --agent <codex|claude|gemini>` (or the installed binary) inside a Git repo; the command seeds or refreshes the target persistency directory even if it does not exist yet.
- The CLI gathers project metadata from Git, regenerates the knowledge-base scaffold and `persistency.config.env`, and writes fresh `ai-start.sh`, `ai-upsert.sh`, and `persistency.upsert.prompt.mdc` files.
- Once it finishes, run `ai/ai-start.sh` for an interactive session or `ai/ai-upsert.sh` for a one-shot alignment; both stream the curated prompt and knowledge-base snapshot to your chosen agent.
- Agent installation and API keys remain your responsibility—the tool never checks or stores credentials and assumes the agent binary name matches the selected `--agent` value.

Refresh or seed an AI Persistency Layer inside any Git repository.  
The tool mirrors the behaviour of the original `init-persistency-layer.sh` script while upgrading it to an idempotent TypeScript/ESM CLI that can create the layer from scratch or reshape an existing one without wiping its history.

## Feature

Take any Git project—brownfield or greenfield—and leave it with a curated, agent-ready AI persistency layer. The CLI infers defaults from Git metadata (plus any prior `.persistency-meta.json`), rebuilds the knowledge-base scaffold, and regenerates `ai-start.sh`, `ai-upsert.sh`, `persistency.config.env`, and the upsert prompt so agents can ingest the latest context. First-time runs create the entire structure; subsequent runs refresh it in-place (optionally creating a timestamped backup) without prompting for extra input. Authentication and agent configuration stay entirely in your hands—the tool never inspects binaries or credentials.

## Installation

- Run without installing:  
  ```bash
  npx @dox-op/ai-persistency-layer --agent claude
  ```
- Install globally (optional):  
  ```bash
  npm install -g @dox-op/ai-persistency-layer
  # then
  ai-persistency-layer --agent claude
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
| `--ai-cmd <cmd>` | Explicit agent command/binary (overrides the default value inferred from `--agent`). |
| `--default-model <string>` | Default model identifier. |
| `--asset <path>` | Extra asset to copy into the layer (repeatable). |
| `--intake-notes <text>` | Supplemental notes or document references injected into the migration brief. |
| `--force` | Overwrite existing files. |
| `--keep-backup` | Retain the previous layer in `ai-backup/` before regenerating. |
| `--log-history` | Append refresh details to `_bootstrap.log` (default: off). |
| `-h, --help` | Display help. |

### Persistency directory discovery

The CLI looks for metadata in the `ai/` folder by default. If
`.persistency-meta.json` is missing, it checks `.persistency-path`; if that is
absent too, it falls back to the default `ai/` directory. Whatever directory is
used gets recorded in `.persistency-path` so future runs remain hands-free.

## Exit Codes

| Code | Meaning |
| ---- | ------- |
| `0` | Success |
| `1` | Generic failure |
| `2` | Not a git repository |
| `3` | Reserved for agent CLI checks |
| `4` | Reserved for authentication checks |
| `5` | Invalid arguments |

## Anti-Drift Automation

Every run emits:

- `scripts/ai/check-stale.ts` – validates freshness targets (7 days / 200 commits).
- `scripts/ai/refresh-layer.ts` – re-runs the bootstrap, forwarding any extra CLI arguments you pass to the script.

## Persistency Lifecycle

`ai-persistency-layer` sets up or refreshes the baseline; keeping it current requires a continuous workflow:

1. **Functional loop (BA/PO):** Use the generated layer as shared context for AI copilots or agents when preparing new tasks for the development team.
2. **Delivery loop (dev team):** Implement features and update the persistency layer as part of the Definition of Done, feeding new insights back into the `.mdc` files.
3. **Review loop (BA/PO):** Validate the updated layer, then start the next iteration by generating new tasks with the refreshed knowledge.

The CLI does not replace these feedback loops—it supplies the scaffolding that downstream processes must keep in sync.

## Migration Workflow

- The CLI creates the target persistency directory if it is missing, seeding the canonical structure for greenfield projects.
- Existing layers are refreshed in-place; pass `--keep-backup` to capture a timestamped snapshot before files are regenerated.
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
Every run regenerates two scripts under `scripts/ai/`:
- `check-stale.ts` reads `.persistency-meta.json` and exits with a non-zero code if the layer breaches the default freshness SLO (7 days or 200 commits). It is designed for CI or scheduled tasks.
- `refresh-layer.ts` re-runs the bootstrap (`ai-persistency-layer ...`), allowing you to schedule periodic regenerations or respond to drift alerts.

**Where do I store the settings that keep the layer idempotent?**  
The bootstrap creates `persistency.config.env` at the root of the layer. It captures the project name, reference paths, agent command, and the relative paths for the three domains. Extend it with your own variables or orchestration scripts if needed; the CLI regenerates or updates it on every run while keeping the configuration within the layer.
> If you omit `--ai-cmd`, the CLI records the agent name (e.g. `codex`, `claude`, `gemini`) as the command. Edit `persistency.config.env` if your binary uses a different name or path.
