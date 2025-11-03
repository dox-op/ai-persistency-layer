# Installation & Setup

This guide explains how to install and configure `@dox-op/ai-persistency-layer` and the underlying AI agent CLIs.

## 1. Prerequisites

- Node.js 20 or later
- `pnpm` (recommended) or `npm`
- Git repository (the CLI must run inside one)

## 2. Agent setup (optional)

`ai-persistency-layer` does not validate or store your credentials. Make sure the AI agent CLI you intend to use (Codex, Claude, or Gemini) is installed and authenticated before you launch `ai/ai-start.sh` or `ai/ai-upsert.sh`. The generated `persistency.config.env` will default `AI_CMD` to the agent name; edit it if your binary lives elsewhere.

## 3. Install the CLI

Choose one of the following approaches:

- **Run on demand (no install):**
  ```bash
  npx @dox-op/ai-persistency-layer --agent claude
  ```
- **Install globally:**
  ```bash
  npm install -g @dox-op/ai-persistency-layer
  ai-persistency-layer --agent claude
  ```

## 4. Running the CLI

From the root of your project repository:

```bash
ai-persistency-layer --agent claude
```

The CLI runs non-interactively: it infers project metadata from Git (and any prior `.persistency-meta.json`) and either seeds the persistency directory or refreshes it in place. Pass `--keep-backup` if you want a timestamped copy of the previous layer before the refresh proceeds.

> Tip: script the CLI (see README for flag reference) to mirror an automated pipeline. Every run emits `persistency.upsert.prompt.mdc` in the project root for the next AI session.

## 5. Verifying the Setup

1. Check that the `ai/` directory (or custom `--persistency-dir`) contains the three domain folders plus their `index.mdc` summary files.
2. Review `ai-meta/migration-brief.mdc`; it captures the migration instructions, supplemental notes, and the truth commit to reconcile.
3. Inspect `persistency.upsert.prompt.mdc` in the project root; `ai/ai-start.sh` and `ai/ai-upsert.sh` will stream it into the agent when you run them manually.
4. Ensure `ai-start.sh` and `ai-upsert.sh` are executable: `./ai/ai-start.sh --help`.
5. Run `scripts/ai/check-stale.ts` to confirm freshness scripts work.

## 6. Need to customize?

If you're contributing changes to the CLI itself:

```bash
pnpm install
pnpm dev        # tsx src/cli.ts
pnpm build      # produces dist/
pnpm link --global
```

Only contributors need these steps; end users installing from npm already receive the compiled binaries.
