# Installation & Setup

This guide explains how to install and configure `@dox-op/ai-persistency-layer` and the underlying AI agent CLIs.

## 1. Prerequisites

- Node.js 20 or later
- `pnpm` (recommended) or `npm`
- Git repository (the CLI must run inside one)
- Credentials for the AI agent CLI you plan to use (Codex, Claude, or Gemini)

## 2. Authentication Environment Variables

The CLI requires each agent to be authenticated before it can generate the persistency layer.  
Configure at least one of the variables listed below (or ensure the equivalent credentials file exists):

| Agent | Environment variable(s) | Fallback credential file(s) |
| ----- | ----------------------- | --------------------------- |
| Codex | `CODEX_API_KEY`, `OPENAI_API_KEY` | `~/.config/codex/credentials`, `~/.codex/credentials` |
| Claude | `ANTHROPIC_API_KEY` | `~/.config/claude/credentials`, `~/.claude/credentials` |
| Gemini | `GOOGLE_API_KEY`, `GEMINI_API_KEY` | `~/.config/gemini/credentials`, `~/.gemini/credentials` |

If none of the variables or files are found, the tool pings the agent CLI. If the binary is already logged in (for example via `codex login`), execution continues with a warning; otherwise it exits with code `4` so that authentication can be completed safely.

Example (Codex):

```bash
export OPENAI_API_KEY="sk-your-key"
```

## 3. Install the CLI

Choose one of the following approaches:

- **Run on demand (no install):**
  ```bash
  npx @dox-op/ai-persistency-layer --agent claude --write-config --yes
  ```
- **Install globally:**
  ```bash
  npm install -g @dox-op/ai-persistency-layer
  ai-persistency-layer --agent claude --write-config --yes
  ```

## 4. Running the CLI

From the root of your project repository:

```bash
ai-persistency-layer --agent claude --write-config --yes
```

Use `--non-interactive` for automation and `--install-method` to control CLI installation (`pnpm`, `npm`, `pipx`, `brew`, or `skip`).

## 5. Verifying the Setup

1. Check that the `ai/` directory (or custom `--persistency-dir`) now contains the three domain folders: `functional/`, `technical/`, `ai-meta/`.
2. Ensure `ai-start.sh` is executable: `./ai/ai-start.sh --help`.
3. Run `scripts/ai/check-stale.ts` (if generated) to confirm freshness scripts work.

## 6. Need to customize?

If you're contributing changes to the CLI itself:

```bash
pnpm install
pnpm dev        # tsx src/cli.ts
pnpm build      # produces dist/
pnpm link --global
```

Only contributors need these steps; end users installing from npm already receive the compiled binaries.
