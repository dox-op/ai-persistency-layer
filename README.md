# @dox-op/ai-persistency-layer

Bootstrap or refresh an AI Persistency Layer inside an existing Git repository.  
The tool mirrors the behaviour of the original `init-persistency-layer.sh` script while upgrading it to an idempotent TypeScript/ESM CLI.

## Features

- Validates execution inside a Git repository (exit code `2` otherwise).
- Interactive prompts via Inquirer or fully headless operation with `--non-interactive`.
- Detects, installs, or updates Codex, Claude, or Gemini CLIs using `execa`.
- Authenticates by checking standard environment variables and credential files (see “Authentication Requirements”).
- Generates deterministic `.mdc` knowledge bases, rules, and bootstrap content.
- Creates `ai-start.sh`, `ai-config.env`, `_bootstrap.log`, and anti-drift scripts.
- Captures a Git snapshot for the chosen truth branch and records freshness metrics.

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
| `--ai-cmd <cmd>` | Explicit agent command/binary. |
| `--install-method <pnpm|npm|brew|pipx|skip>` | Preferred installation strategy. |
| `--default-model <string>` | Default model identifier. |
| `--write-config` | Write `ai-config.env` and anti-drift scripts. |
| `--asset <path>` | Extra asset to copy into the layer (repeatable). |
| `--non-interactive` | Fail instead of prompting for missing inputs. |
| `--yes` | Auto-confirm prompts (implies `--write-config`). |
| `--force` | Overwrite existing files. |
| `--start-session` | Launch the agent immediately after bootstrapping. |
| `-h, --help` | Display help. |

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

If none of the variables exist and no credential file is found, the CLI stops with exit code `4` so you can configure authentication safely.

## Local Development (optional)

```bash
pnpm install
pnpm dev        # tsx src/cli.ts
pnpm build      # tsc
```

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

### Handling Drift and Scale

This tool is not a silver bullet for AI-agent adoption; treat the suggestions below as starting points to tailor to your team:

- Track layer revisions with Git alongside application code.
- Split content by environment or domain to stay within context limits.
- Consider training dedicated LLMs or fine-tuned embeddings on the persistency layer so agents can reference large documents without re-ingesting every file.
- Schedule regular refreshes (automated or manual) to prevent the layer from diverging from the truth branch.

## Logging & Metadata

- `_bootstrap.log` stores chronological activity.
- `.persistency-meta.json` tracks last refresh, snapshot commit, and freshness metrics.

## Start Script

`ai-start.sh` is created (or updated) to export helpful environment variables and exec the selected AI CLI, ensuring consistent sessions.
