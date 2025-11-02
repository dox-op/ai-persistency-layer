#!/usr/bin/env bash
# shellcheck disable=SC2002,SC2086,SC2046,SC2312
# -------------------------------------------------------------------------------------------------
# init-persistency-layer.sh
# -------------------------------------------------------------------------------------------------
# Bootstrap (or refresh) an "AI persistency layer" inside an existing Git repository.
#
# The persistency layer is a structured set of .mdc files and helper scripts that:
#   - codify functional, technical, and AI‑meta knowledge for an AI Agent CLI
#   - establish recursion rules: the Agent should update this layer as it learns
#   - define a clean folder division (functional / technical / ai-meta)
#   - provide a spawner (ai-start.sh) to inject the layer into the chosen Agent
#   - ship with a minimal knowledge base (taxonomy, indices, entity/state analysis stubs)
#
# Supported Agents (via CLI): codex | claude | gemini
#   * Best-effort installation/upgrade is attempted; you can override the detection via --ai-cmd
#   * The script expects your Agent to be already authenticated; if not, it exits
#
# USAGE
#   chmod +x init-persistency-layer.sh
#   ./init-persistency-layer.sh \
#       --agent codex \
#       --persistency-dir ai \
#       --prod-branch main \
#       --asset exports/specs.csv --asset docs/confluence-export.zip \
#       --prev-layer path/to/legacy-ai-layer \
#       --yes
#
# FLAGS
#   --project-name <name>       Project name (default: current folder name)
#   --project-path <path>       Project path (default: current working directory)
#   --persistency-dir <path>    Target folder for the layer (default: ai)
#   --prev-layer <path>         Existing/legacy layer path (optional)
#   --prod-branch <branch>      Branch closest to production (default: current branch)
#   --agent <codex|claude|gemini>  Which Agent CLI to use
#   --ai-cmd <cmd>              Explicit CLI command to invoke (overrides autodetect)
#   --install-method <pnpm|npm|brew|pipx|skip>  Force a method (optional)
#   --asset <path>              Extra textual inputs (repeatable)
#   --non-interactive           Fail if required info is missing instead of prompting
#   --yes                       Assume "yes" for confirmations
#   --force                     Overwrite existing files when needed
#   -h | --help                 Show help
#
# EXIT CODES
#   0  success
#   1  generic failure
#   2  not a git repository
#   3  agent CLI missing and install failed
#   4  agent not authenticated (API key/config missing)
#   5  invalid arguments
# -------------------------------------------------------------------------------------------------

set -Eeuo pipefail
IFS=$'\n\t'

# -------------------------------------
# Pretty printing helpers
# -------------------------------------
info()    { printf "\033[1;34m[INFO]\033[0m %s\n" "$*"; }
success() { printf "\033[1;32m[SUCCESS]\033[0m %s\n" "$*"; }
warn()    { printf "\033[1;33m[WARN]\033[0m %s\n" "$*"; }
err()     { printf "\033[1;31m[ERROR]\033[0m %s\n" "$*" >&2; }
rule()    { printf "\033[90m%s\033[0m\n" "--------------------------------------------------------------------------------"; }

confirm() {
  local prompt=${1:-"Proceed? [y/N] "}
  if [[ ${ASSUME_YES:-0} -eq 1 ]]; then return 0; fi
  read -r -p "$prompt" reply || true
  case ${reply:-n} in
    y|Y|yes|YES) return 0;;
    *) return 1;;
  esac
}

# -------------------------------------
# Defaults and CLI parsing
# -------------------------------------
PROJECT_PATH=$(pwd)
PROJECT_NAME=$(basename "$PROJECT_PATH")
PERSISTENCY_DIR="ai"
PREV_LAYER=""
PROD_BRANCH=""
AGENT=""
AI_CMD=""
INSTALL_METHOD=""
ASSETS=()
NON_INTERACTIVE=0
ASSUME_YES=0
FORCE=0

usage() {
  sed -n '1,120p' "$0" | sed 's/^# \{0,1\}//'
}

fail() { err "$1"; exit "${2:-1}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-name) PROJECT_NAME="$2"; shift 2;;
    --project-path) PROJECT_PATH="$2"; shift 2;;
    --persistency-dir) PERSISTENCY_DIR="$2"; shift 2;;
    --prev-layer) PREV_LAYER="$2"; shift 2;;
    --prod-branch) PROD_BRANCH="$2"; shift 2;;
    --agent) AGENT="${2,,}"; shift 2;;
    --ai-cmd) AI_CMD="$2"; shift 2;;
    --install-method) INSTALL_METHOD="${2,,}"; shift 2;;
    --asset) ASSETS+=("$2"); shift 2;;
    --non-interactive) NON_INTERACTIVE=1; shift;;
    --yes) ASSUME_YES=1; shift;;
    --force) FORCE=1; shift;;
    -h|--help) usage; exit 0;;
    *) fail "Unknown argument: $1" 5;;
  esac
done

cd "$PROJECT_PATH" || fail "Cannot cd into $PROJECT_PATH"

# -------------------------------------
# Preconditions
# -------------------------------------
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "This must be run inside a Git repository." 2
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
PROD_BRANCH=${PROD_BRANCH:-$CURRENT_BRANCH}

if [[ -z "$AGENT" && $NON_INTERACTIVE -eq 1 ]]; then
  fail "--agent is required in non-interactive mode" 5
fi

if [[ -z "$AGENT" ]]; then
  info "Agent not specified. Choose one: [codex|claude|gemini]"
  read -r -p "Agent: " AGENT || true
  AGENT=${AGENT,,}
fi

case "$AGENT" in
  codex|claude|gemini) :;;
  *) fail "Unsupported --agent '$AGENT'. Use: codex | claude | gemini" 5;;
esac

# -------------------------------------
# Resolve project name/path interactively if needed
# -------------------------------------
if [[ $NON_INTERACTIVE -eq 0 ]]; then
  info "Detected project: $PROJECT_NAME at $REPO_ROOT (branch: $PROD_BRANCH)"
  if ! confirm "Is this correct? [Y/n] "; then
    read -r -p "Project name: " PROJECT_NAME || true
    read -r -p "Project path: " PROJECT_PATH || true
    PROJECT_PATH=${PROJECT_PATH:-$REPO_ROOT}
  fi

  rule
  info "Optional: add textual assets (CSV exports, Confluence zips, tech/functional docs)."
  info "Press ENTER to skip or provide paths separated by spaces."
  read -r -p "Assets: " MAYBE_ASSETS || true
  if [[ -n "${MAYBE_ASSETS:-}" ]]; then
    # split on spaces, preserve quoted paths via eval-read
    # shellcheck disable=SC2206
    ASSETS+=( ${MAYBE_ASSETS} )
  fi

  rule
  read -r -p "Path to an existing persistency layer (if any) [empty = none]: " MAYBE_PREV || true
  PREV_LAYER=${PREV_LAYER:-${MAYBE_PREV:-}}

  rule
  read -r -p "Production (truth) branch [$PROD_BRANCH]: " MAYBE_BRANCH || true
  PROD_BRANCH=${MAYBE_BRANCH:-$PROD_BRANCH}
fi

# Validate branch existence (local or remote)
if ! git rev-parse --verify --quiet "$PROD_BRANCH" >/dev/null; then
  if git show-ref --verify --quiet "refs/remotes/origin/$PROD_BRANCH"; then
    info "Creating local tracking branch for origin/$PROD_BRANCH"
    git branch --track "$PROD_BRANCH" "origin/$PROD_BRANCH" >/dev/null 2>&1 || true
  else
    warn "Branch '$PROD_BRANCH' not found locally or in origin. Falling back to current branch '$CURRENT_BRANCH'."
    PROD_BRANCH=$CURRENT_BRANCH
  fi
fi

# -------------------------------------
# Agent CLI detection & (best-effort) install/upgrade
# -------------------------------------
# You can override command via --ai-cmd. Otherwise we try known commands per agent.

choose_default_ai_cmd() {
  case "$AGENT" in
    codex)   echo "codex";;
    claude)  # Prefer 'anthropic' official CLI if present, else 'claude'
              if command -v anthropic >/dev/null 2>&1; then echo "anthropic"; else echo "claude"; fi;;
    gemini)  # Try 'gcloud' first (Vertex AI), else 'gemini' if user provides a custom CLI
              if command -v gcloud >/dev/null 2>&1; then echo "gcloud"; else echo "gemini"; fi;;
  esac
}

AI_CMD=${AI_CMD:-$(choose_default_ai_cmd)}

install_or_update_agent_cli() {
  local cmd="$1"
  local method="${INSTALL_METHOD:-}"
  case "$AGENT:$cmd" in
    codex:codex)
      # Heuristic NPM global package names; adjust if your environment differs
      if ! command -v codex >/dev/null 2>&1; then
        info "Installing 'codex' CLI ..."
        if [[ "$method" == "pnpm" ]] && command -v pnpm >/dev/null 2>&1; then
          pnpm add -g codex-cli || true
        elif [[ "$method" == "npm" ]] && command -v npm >/dev/null 2>&1; then
          npm i -g codex-cli || true
        elif command -v pnpm >/dev/null 2>&1; then
          pnpm add -g codex-cli || true
        elif command -v npm >/dev/null 2>&1; then
          npm i -g codex-cli || true
        else
          warn "pnpm/npm not available; cannot auto-install codex-cli."
        fi
      else
        info "codex CLI already present. Attempting upgrade (best-effort)."
        if command -v pnpm >/dev/null 2>&1; then pnpm update -g codex-cli || true; fi
        if command -v npm  >/dev/null 2>&1; then npm  update -g codex-cli || true; fi
      fi
      ;;
    claude:anthropic|claude:claude)
      if ! command -v "$cmd" >/dev/null 2>&1; then
        info "Installing '$cmd' CLI ..."
        # Try pipx, then brew, then npm fallbacks
        if command -v pipx >/dev/null 2>&1; then
          pipx install anthropic || true
        elif command -v brew >/dev/null 2>&1; then
          brew install anthropic || true
        elif command -v pnpm >/dev/null 2>&1; then
          pnpm add -g @anthropic-ai/cli || true
        elif command -v npm >/dev/null 2>&1; then
          npm i -g @anthropic-ai/cli || true
        else
          warn "No suitable installer found for 'anthropic' CLI."
        fi
      else
        info "'$cmd' CLI present. Attempting upgrade (best-effort)."
        if command -v pipx >/dev/null 2>&1; then pipx upgrade anthropic || true; fi
        if command -v brew >/dev/null 2>&1; then brew upgrade anthropic || true; fi
        if command -v pnpm >/dev/null 2>&1; then pnpm update -g @anthropic-ai/cli || true; fi
        if command -v npm  >/dev/null 2>&1; then npm  update -g @anthropic-ai/cli || true; fi
      fi
      ;;
    gemini:gcloud|gemini:gemini)
      if [[ "$cmd" == "gcloud" ]]; then
        if ! command -v gcloud >/dev/null 2>&1; then
          warn "gcloud not installed. Please install Google Cloud CLI manually if you want Vertex AI."
        else
          # Ensure components are up-to-date
          gcloud components update -q || true
        fi
      else
        # If user provided a custom 'gemini' CLI name, we cannot auto-install reliably.
        warn "Unknown Gemini CLI '$cmd'. Skipping auto-install; ensure it's on PATH."
      fi
      ;;
  esac

  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Agent CLI '$cmd' not found after install attempt. Provide --ai-cmd or install manually."
    exit 3
  fi
}

install_or_update_agent_cli "$AI_CMD"

# -------------------------------------
# Authentication checks (lightweight)
# -------------------------------------
case "$AGENT:$AI_CMD" in
  codex:codex)
    if [[ -z "${CODEX_API_KEY:-}" ]] && [[ ! -f "$HOME/.codex/config" ]]; then
      fail "codex not authenticated (missing CODEX_API_KEY or ~/.codex/config)." 4
    fi
    ;;
  claude:anthropic|claude:claude)
    if [[ -z "${ANTHROPIC_API_KEY:-}" ]] && [[ ! -f "$HOME/.config/anthropic/credentials" ]]; then
      fail "Claude not authenticated (missing ANTHROPIC_API_KEY or credentials file)." 4
    fi
    ;;
  gemini:gcloud)
    if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
      fail "gcloud not authenticated for ADC (run 'gcloud auth application-default login')." 4
    fi
    ;;
  gemini:gemini)
    if [[ -z "${GEMINI_API_KEY:-${GOOGLE_API_KEY:-}}" ]]; then
      fail "Gemini CLI not authenticated (missing GEMINI_API_KEY/GOOGLE_API_KEY)." 4
    fi
    ;;
  *) :;;
esac

# -------------------------------------
# Prepare target structure
# -------------------------------------
TARGET_DIR="$REPO_ROOT/$PERSISTENCY_DIR"
BACKUP_DIR="$TARGET_DIR/_previous"
INPUTS_DIR="$TARGET_DIR/inputs"
RULES_DIR="$TARGET_DIR/ai-rules"
KNOW_DIR="$TARGET_DIR/knowledge"
INDICES_DIR="$TARGET_DIR/indices"
FUNC_DIR="$TARGET_DIR/functional"
TECH_DIR="$TARGET_DIR/technical"
AIMETA_DIR="$TARGET_DIR/ai-meta"
CONTEXT_DIR="$TARGET_DIR/context"
LOG_FILE="$TARGET_DIR/_bootstrap.log"

mkdir -p "$TARGET_DIR" "$INPUTS_DIR" "$RULES_DIR" "$KNOW_DIR" "$INDICES_DIR" \
         "$FUNC_DIR" "$TECH_DIR" "$AIMETA_DIR" "$CONTEXT_DIR"

# Backup previous layer if provided and different from target
if [[ -n "$PREV_LAYER" ]]; then
  if [[ -d "$PREV_LAYER" ]]; then
    info "Importing previous layer from $PREV_LAYER"
    mkdir -p "$BACKUP_DIR"
    rsync -a --exclude "_previous" "$PREV_LAYER"/ "$BACKUP_DIR"/
  else
    warn "--prev-layer path not found: $PREV_LAYER"
  fi
fi

# Copy assets
if [[ ${#ASSETS[@]} -gt 0 ]]; then
  info "Copying textual assets into $INPUTS_DIR"
  for a in "${ASSETS[@]}"; do
    if [[ -e "$a" ]]; then
      cp -R "$a" "$INPUTS_DIR"/
    else
      warn "Asset not found: $a"
    fi
  done
fi

# -------------------------------------
# Generate minimal knowledge base and rules
# -------------------------------------
now_iso=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$RULES_DIR/001-recursivity.mdc" << 'EOF'
# Rule · Recursivity & Self‑Updating Layer
- You (the AI Agent) MUST treat this persistency layer as the **source of truth** for context.
- When you learn new functional, technical, or AI‑meta facts from:
  - reading the codebase
  - running tests or scripts
  - interacting with stakeholders or tasks
  - parsing inputs from `/ai/inputs`
  you MUST update the relevant `.mdc` files **in place**, keeping the division rules below.
- Always keep changes concise, dated, and attributed (append a short changelog note).
- Never delete information without justification; prefer deprecating with a rationale.
EOF

cat > "$RULES_DIR/002-division.mdc" << 'EOF'
# Rule · Division of Knowledge (Functional / Technical / AI‑Meta)
- **functional/**: domain concepts, entities, user journeys, requirements, acceptance criteria.
- **technical/**: architecture, data models, APIs, integrations, devops, constraints.
- **ai-meta/**: agent usage guidelines, prompting patterns, context injection strategy.
- This separation is **mandatory** and must persist over time, including during recursive updates.
EOF

cat > "$RULES_DIR/003-spawner.mdc" << 'EOF'
# Rule · Spawner / Injection
- The `ai-start.sh` MUST:
  1) load all relevant `.mdc` files (rules first, then knowledge, indices, functional, technical, ai-meta)
  2) pass the aggregated context to the selected Agent CLI
  3) allow extra prompts to be appended when launching sessions
- Sessions MUST explicitly state the **target outcome** and reference indices.
EOF

cat > "$KNOW_DIR/010-taxonomy-of-software-problems.mdc" << 'EOF'
# Knowledge · Taxonomy of Software Problems (for triage & framing)
- Requirements & Scope
- Domain Modeling & Entities (FSMs, invariants)
- Architecture & Design
- Data (schema, migrations, integrity, lineage)
- Build & Packaging
- Environment & Configuration
- Dependencies & Supply Chain
- Runtime & Infra (networking, OS, container, cloud)
- Observability (logs, metrics, traces)
- Security & Compliance
- Testing (unit, integration, e2e), Test Data
- Performance & Scalability
- UX & Accessibility
- CI/CD & Release Management
- Operational Procedures & SRE
- External Services & Integrations
- Product Analytics & Experiments
- Project/Process (Scrum, Kanban, RACI)
EOF

cat > "$KNOW_DIR/020-entity-and-fsm-analysis.mdc" << 'EOF'
# Knowledge · Entity & Finite State Machine Analysis
- For each domain entity:
  - define attributes, identifiers, and invariants
  - model states and allowed transitions (FSM)
  - attach preconditions/postconditions
  - note where state is enforced (DB, code, external system)
- Provide both **functional** (why) and **technical** (how) views.
EOF

cat > "$INDICES_DIR/000-index.mdc" << EOF
# Indices · Entrypoints
- Project: **$PROJECT_NAME**
- Repo: **$REPO_ROOT**
- Truth branch: **$PROD_BRANCH**
- Last bootstrap: **$now_iso**

## Pointers
- Rules: /$PERSISTENCY_DIR/ai-rules/*.mdc
- Knowledge: /$PERSISTENCY_DIR/knowledge/*.mdc
- Inputs: /$PERSISTENCY_DIR/inputs
- Functional: /$PERSISTENCY_DIR/functional
- Technical: /$PERSISTENCY_DIR/technical
- AI‑Meta: /$PERSISTENCY_DIR/ai-meta
EOF

# -------------------------------------
# Snapshot code at chosen branch (non-destructive)
# -------------------------------------
SNAP_FILE="$CONTEXT_DIR/code-snapshot-${PROD_BRANCH//\//_}-$now_iso.mdc"

info "Generating code snapshot from branch '$PROD_BRANCH'"
# Collect simple inventory: directories, top-level files, extension histogram
{
  echo "# Context · Code Snapshot ($PROD_BRANCH)"
  echo "- generated: $now_iso"
  echo
  echo "## Top-level structure"
  git ls-tree -z --name-only "$PROD_BRANCH" | tr '\0' '\n' | sed 's/^/- /'
  echo
  echo "## File extension histogram (top 30)"
  git ls-tree -r --name-only "$PROD_BRANCH" \
    | awk -F. '{ext=$NF; if (NF==1) ext="<none>"; c[ext]++} END {for (k in c) printf "%7d %s\n", c[k], k}' \
    | sort -rn | head -n 30 | sed 's/^/- /'
} > "$SNAP_FILE"

# -------------------------------------
# Create/update ai-bootstrap.mdc
# -------------------------------------
cat > "$TARGET_DIR/ai-bootstrap.mdc" << EOF
# AI Bootstrap · $PROJECT_NAME
- Repo root: $REPO_ROOT
- Truth branch: $PROD_BRANCH
- Bootstrap timestamp: $now_iso

## Session Defaults
- Always load rules, knowledge, indices, then functional/technical/ai-meta.
- Prefer minimal diffs; append change notes.
- Use indices to anchor tasks and persist new facts.

## Immediate TODOs for the Agent (safe starters)
1) Validate the taxonomy against the code snapshot ($SNAP_FILE) and refine.
2) Build entity maps and FSMs for core domain objects into **functional/**.
3) Produce a technical integration map (APIs, DBs, external systems) into **technical/**.
4) Normalize prompts/guardrails into **ai-meta/** (role, tone, update policies).
EOF

# -------------------------------------
# Create ai-start.sh (idempotent)
# -------------------------------------
STARTER="$TARGET_DIR/ai-start.sh"
if [[ -f "$STARTER" && $FORCE -ne 1 ]]; then
  warn "ai-start.sh already exists. Use --force to overwrite."
else
  cat > "$STARTER" << 'EOS'
#!/usr/bin/env bash
set -Eeuo pipefail
# ai-start.sh — aggregate .mdc context and launch the chosen AI Agent CLI
# Configure via env vars (with sensible defaults):
#   AI_AGENT   = codex | claude | gemini   (default: codex)
#   AI_CMD     = explicit CLI command      (default: auto-detect per agent)
#   MODEL_HINT = optional model name       (e.g., claude-3-7-sonnet)
#   EXTRA_CTX  = extra file or folder to cat before prompt (optional)
#   PROMPT     = a one-shot prompt override (else read from stdin/tty)

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

AI_AGENT=${AI_AGENT:-codex}
AI_CMD=${AI_CMD:-}
MODEL_HINT=${MODEL_HINT:-}

choose_cmd() {
  case "$AI_AGENT" in
    codex)   command -v ${AI_CMD:-codex}   >/dev/null 2>&1 && echo "${AI_CMD:-codex}"   || echo "codex" ;;
    claude)  command -v ${AI_CMD:-anthropic} >/dev/null 2>&1 && echo "${AI_CMD:-anthropic}" || (command -v claude >/dev/null 2>&1 && echo claude || echo anthropic) ;;
    gemini)  command -v ${AI_CMD:-gcloud}  >/dev/null 2>&1 && echo "${AI_CMD:-gcloud}"  || echo "gcloud" ;;
  esac
}

CMD=$(choose_cmd)

# Build context buffer in a deterministic order
CONTEXT=$(mktemp)
cat "$HERE/ai-rules/"*.mdc            >> "$CONTEXT" 2>/dev/null || true
cat "$HERE/knowledge/"*.mdc           >> "$CONTEXT" 2>/dev/null || true
cat "$HERE/indices/"*.mdc             >> "$CONTEXT" 2>/dev/null || true
find "$HERE/functional" -type f -name '*.mdc' -print0 | xargs -0 cat >> "$CONTEXT" 2>/dev/null || true
find "$HERE/technical"  -type f -name '*.mdc' -print0 | xargs -0 cat >> "$CONTEXT" 2>/dev/null || true
find "$HERE/ai-meta"    -type f -name '*.mdc' -print0 | xargs -0 cat >> "$CONTEXT" 2>/dev/null || true
cat "$HERE/ai-bootstrap.mdc"           >> "$CONTEXT" 2>/dev/null || true

if [[ -n "${EXTRA_CTX:-}" ]]; then
  if [[ -d "$EXTRA_CTX" ]]; then
    find "$EXTRA_CTX" -type f -maxdepth 1 -name '*.mdc' -print0 | xargs -0 cat >> "$CONTEXT" || true
  elif [[ -f "$EXTRA_CTX" ]]; then
    cat "$EXTRA_CTX" >> "$CONTEXT"
  fi
fi

PROMPT_INPUT=${PROMPT:-}
if [[ -z "$PROMPT_INPUT" ]]; then
  echo "Enter your prompt (Ctrl+D to submit):" >&2
  PROMPT_INPUT=$(cat)
fi

case "$AI_AGENT:$CMD" in
  codex:codex)
    # Codex CLI: accepts the whole context + prompt as a single input string
    codex "$(cat "$CONTEXT")

---

$PROMPT_INPUT" ;;
  claude:anthropic)
    anthropic messages create \
      --model "${MODEL_HINT:-claude-3-7-sonnet-latest}" \
      --input "$(cat "$CONTEXT")

---

$PROMPT_INPUT" ;;
  gemini:gcloud)
    # Vertex AI via gcloud (text model). Adjust model if needed.
    gcloud ai generative-text generate \
      --location=us-central1 \
      --model="${MODEL_HINT:-gemini-1.5-pro-002}" \
      --text-input "$(cat "$CONTEXT")

---

$PROMPT_INPUT" ;;
  *)
    echo "Unsupported AI_AGENT/CMD combination: $AI_AGENT:$CMD" >&2
    exit 1 ;;
esac

rm -f "$CONTEXT"
EOS
  chmod +x "$STARTER"
  success "Created $STARTER"
fi

# -------------------------------------
# Seed minimal readmes for the three divisions (idempotent)
# -------------------------------------
seed_div() {
  local dir="$1"; local title="$2";
  local f="$dir/README.mdc"
  if [[ ! -f "$f" || $FORCE -eq 1 ]]; then
    cat > "$f" << EOF
# $title
- Owner: $PROJECT_NAME
- Established: $now_iso
- Conventions: keep concise, date updates, link to indices.
EOF
  fi
}
seed_div "$FUNC_DIR"    "Functional Layer"
seed_div "$TECH_DIR"    "Technical Layer"
seed_div "$AIMETA_DIR"  "AI‑Meta Layer"

# -------------------------------------
# Log and final output
# -------------------------------------
{
  echo "[$now_iso] bootstrap completed"
  echo "project=$PROJECT_NAME repo=$REPO_ROOT branch=$PROD_BRANCH agent=$AGENT cmd=$AI_CMD"
  echo "persistency_dir=$TARGET_DIR"
  echo "assets_count=${#ASSETS[@]} prev_layer=$PREV_LAYER"
} >> "$LOG_FILE"

rule
success "Persistency layer ready at: $TARGET_DIR"
info "Starter: $STARTER"
info "Code snapshot: $SNAP_FILE"
rule

if confirm "Open a first Agent session now? [y/N] "; then
  AI_AGENT="$AGENT" AI_CMD="$AI_CMD" "$STARTER"
fi

exit 0
