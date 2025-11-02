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

If none of the variables or files are found, the CLI exits with code `4` so that authentication can be completed safely.

Example (Codex):

```bash
export OPENAI_API_KEY="sk-your-key"
```

## 3. Install Dependencies

```bash
pnpm install
pnpm build
```

To link the CLI locally:

```bash
pnpm link --global
```

This exposes the command as `ai-persistency-layer` in your shell.

## 4. Running the CLI

From the root of your project repository:

```bash
ai-persistency-layer --agent claude --write-config --yes
```

Use `--non-interactive` for automation and `--install-method` to control CLI installation (`pnpm`, `npm`, `pipx`, `brew`, or `skip`).

## 5. Verifying the Setup

1. Check that the `ai/` directory (or custom `--persistency-dir`) contains generated `.mdc` files.
2. Ensure `ai-start.sh` is executable: `./ai/ai-start.sh --help`.
3. Run `scripts/ai/check-stale.ts` (if generated) to confirm freshness scripts work.

## 6. Publishing (summary)

See the README for full publishing instructions. At a glance:

```bash
pnpm build
npm publish --access public
```

Remember to bump the version in `package.json` before each publish.
