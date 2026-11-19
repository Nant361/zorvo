# QWEN.md — Zorvo (formerly Agent Desktop)

Instructional context for Qwen Code when working in this repository. Read this
first; for deeper architecture detail, `CLAUDE.md` is the authoritative
reference, and `docs/development.md` covers the build, checks and release
process.

## What this is

Zorvo is a native macOS desktop app that hosts other coding agents — Claude Code,
Codex, Qwen Code and the rest of the [ACP registry](https://agentclientprotocol.com) —
each in a real chat UI. Agents are driven over the Agent Client Protocol (ACP,
JSON-RPC over stdio), so Zorvo shows each agent's own models, effort levels,
modes, slash commands and permission prompts instead of reimplementing them.

- **Frontend:** React 19, TypeScript (strict), Tailwind 4, Vite, in `src/`.
- **Backend:** Rust, Tauri 2, in `src-tauri/` (crate `zorvo`, lib `zorvo_lib`).
- **Package manager:** pnpm 12; Node version comes from `.nvmrc` (26), which CI
  and the release workflow also read. Node 22+ is the documented runtime floor.
- **Platform:** macOS only (Apple Silicon and Intel); Windows/Linux are roadmap.
- **License:** Apache 2.0. The license does not cover the Zorvo name or logo.

The app never asks for or stores API keys. Agents sign in with their own tools,
GitHub data comes from the user's own `gh`, and there is no telemetry.

## Repository layout

```
src/                    React frontend
  App.tsx               app shell and session orchestration (keep it thin)
  components/           UI by feature: chat, composer, changes, compare,
                        activity, inspector, terminal, agents, settings, files,
                        onboarding, sidebar, topbar, ui (primitives)
  hooks/                focused hooks, one concern each
    session-engine/     useAcpEngine.ts — the ACP session engine
  lib/                  pure helpers (ACP events, persistence, review comments,
                        diff rows, reply quotes, …)
  styles/globals.css    design tokens — single source of truth
  test/                 Vitest + Testing Library tests
src-tauri/              Rust backend
  src/acp/              ACP client: jsonrpc, connection, manager, probe
  src/registry/         ACP registry, version history, catalog view, icons
  src/installer/        agent/runtime installs, pinned hashes
  src/store.rs          state.json and transcripts
  src/changes.rs, diff_stats.rs, worktrees.rs, branches.rs, git_info.rs
  src/pull_requests.rs, github.rs      user's own gh
  src/workspace_terminal.rs, pty_session.rs
  tests/it/             integration tests (one binary)
  tests/fixtures/fake_acp_agent.mjs
site/                   Next.js marketing site, static export to site/out
scripts/                registry/runtimes updates, release signing, checks
docs/                   development guide, design system, brand assets
```

## Commands

Run from the repo root unless noted.

```bash
pnpm install
pnpm tauri dev                                  # Vite on :1420 + Rust backend
pnpm lint                                       # tsc --noEmit + eslint --max-warnings=0
pnpm test                                       # all Vitest tests
pnpm vitest run src/test/persistence.test.ts    # one file
pnpm vitest run src/test/persistence.test.ts -t "name"   # one test
pnpm build                                      # tsc && vite build (frontend only)
pnpm design-system                              # design-system reference on :5180
pnpm registry:update                            # refresh bundled ACP registry history
pnpm runtimes:update                            # refresh pinned runtime hashes
pnpm clean:rust                                 # cargo clean for src-tauri
pnpm tauri build                                # production bundle (only build with CSP)
```

Rust checks (from `src-tauri/`; `pnpm build` must have produced `dist/` first,
because Tauri embeds it at compile time):

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo test --test it acp_manager_test::               # one integration test file
cargo test --test it acp_manager_test::some_name      # one test
```

Site (from the root):

```bash
pnpm --filter zorvo-site dev                    # http://localhost:3100
SITE_URL=https://zorvolabs.xyz pnpm --filter zorvo-site build   # writes site/out/
```

`pnpm tauri build` signs the update package, so it needs
`TAURI_SIGNING_PRIVATE_KEY` (and `_PASSWORD`). To build without signing, append
`--config '{"bundle":{"createUpdaterArtifacts":false}}'`.

## Architecture facts that matter

**Frontend ↔ backend.** The UI calls Tauri commands, all registered in
`src-tauri/src/lib.rs`'s `generate_handler!`, and listens to events:
`acp-event` (one channel for every ACP session), `sign-in-terminal`,
`workspace-terminal`, `agent-install-progress`, `app-update-progress`,
`agent-profiles-changed`, among others. Keep `App.tsx` thin: put new logic in a
hook in `src/hooks/` or a helper in `src/lib/`.

**Session engine.** Every session is an ACP chat run by
`src/hooks/session-engine/useAcpEngine.ts`. Incoming ACP updates are folded
into chat messages by `src/lib/acp-events.ts`. Modes, models and config options
are reported by the agent at session start (`useAcpSessions.ts`,
`lib/acp-draft.ts`) and surfaced through `lib/composer-controls.ts`.

**Agent profiles are the trust boundary.** Registry data is fetched by the Rust
backend, never the webview. The UI sends only an agent id (and a folder);
`acp/commands.rs::launch_for` turns that id into a command line. Never let the
UI pass a raw command, argument or environment. A candidate distribution must
pass `is_valid_entry`; `registry/schema.rs::choose_distribution` picks one at
parse time, preferring a pinned `npx` package, then a pinned `uvx` package, then
a binary with a valid checksum for this Mac. A version is offered only after it
has been listed for 7 days, and the bundled history is refreshed with
`pnpm registry:update`.

**Installer.** `src-tauri/src/installer/` installs only the agent the user
picked, plus Node.js or uv when needed, under the app data dir's `tools/`.
Runtimes are pinned with their SHA-256 in
`src-tauri/resources/runtimes.json`, and every download is checked against a
pinned hash; archives unpack with path and size checks; installs are staged and
renamed into place. The plan is rebuilt in the backend from the agent id, never
taken from the UI.

**Persistence.** `store.rs` writes `state.json` and `transcripts/<id>.json`
atomically under `~/Library/Application Support/xyz.zorvo.desktop/`. Frontend
validation/normalization of loaded state is in `src/lib/persistence.ts`. On load
the UI calls `end_orphaned_sessions`, because a webview reload leaves backend
agents running.

**Path checks.** Every backend command that reads or runs in a folder supplied
by the UI must first call `files::ensure_known_workspace` (canonicalized,
checked against the store's known workspaces). Follow this in any new command.

**Popout windows.** A session can open in its own window
(`index.html?session=<id>&popout=1`). The main window is the single writer: it
parses agent output and persists state; popouts render snapshots and forward
actions through `lib/popout-bridge.ts`, so two windows never write the same
files.

**Fork, rewind, worktrees.** Fork prefers the agent's native ACP fork, otherwise
a handoff file. Worktree sessions get an `agent/<title>` branch under the app
data dir's `worktrees/`. `switch_branch` refuses while any open ACP session works
in the same checkout, and every branch name from the UI is checked against
`refs/heads/` before it reaches git.

**Terminals.** A PTY (`pty_session.rs`) runs an agent's own terminal sign-in and
the workspace shells (`workspace_terminal.rs`). The UI sends only a folder or a
session/terminal id — never a command, argument or environment. `send_input`
stays synchronous so keystrokes reach the PTY in order.

**Threading rule for Tauri commands.** Commands that touch the filesystem, the
login shell or a child process are `#[tauri::command(async)]` so they cannot
freeze the window. `send_input` and `end_orphaned_sessions` stay sync
deliberately, for ordering reasons.

**Environment.** A Finder-launched app has no shell PATH, so `env_resolver.rs`
reads the user's login-shell environment once and every spawn uses it.

**Qwen Code specifics.** Qwen's `ask_user_question` arrives as a normal
`session/request_permission` whose `toolCall._meta` carries
`qwenInteractionKind: "user_question"` and `qwenQuestions`, and expects an
`answers` object in the response. Parsing/validation lives in
`src/lib/user-questions.ts` and `src-tauri/src/acp/permission_response.rs`;
typed values are never stored or logged. Qwen Code's setup method (`openai`) is
in the older terminal form, with no `type` and `_meta.type: "terminal"`, so it
marks the agent's own interactive setup (`Set up Qwen Code`), which runs in the
sign-in PTY. Its failed requests are read from the tail of its own
`projects/*/chats/<id>.jsonl` (`acp/qwen_log.rs`).

## Development conventions

- **TypeScript is strict**, with `noUnusedLocals`, `noUnusedParameters` and
  `noFallthroughCasesInSwitch`. A leading underscore marks a value left out on
  purpose (ESLint is configured for this).
- **Immutability:** return new objects; do not mutate existing ones.
- **Small files:** 200–400 lines typical, 800 as a soft ceiling. Prefer a focused
  hook or component over growing `App.tsx`.
- **Tests are required.** Write the failing test first, then make it pass. New
  functionality needs unit/integration coverage; UI changes should have a
  Testing Library test in `src/test/`.
- **Conventional Commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`, `ci:`. Branches: `feat/…`, `fix/…`, `chore/…`.
- **Changelog:** add a line under `Unreleased` in `CHANGELOG.md` when users would
  notice the change.
- **No secrets in the app.** Never add code that asks for, stores, logs or
  transmits API keys or tokens. The CSP allows only the local IPC bridge, so the
  webview makes no network requests.
- **No raw colors in components.** `design-tokens.test.ts` fails on
  `bg-neutral-800`, `text-white`, `bg-[#121212]` and similar. Use the token
  utilities generated by `src/styles/globals.css` (`bg-surface-2`,
  `text-fg-muted`, `border-border-strong`, …). Change `globals.css` and
  `docs/design-system/tokens.json` together — `design-system-docs.test.ts`
  fails on drift.
- **UI primitives first.** Use `src/components/ui/` (`Button`, `IconButton`)
  before styling a `<button>` by hand. Every focusable control gets the
  `focus-ring` utility. Shadows are `shadow-popover` / `shadow-dialog`.
- **UI copy:** sentence case, short declarative sentences, address the user as
  "you", name the agents rather than saying "AI", no exclamation marks or emoji.
  See `docs/design-system/README.md`.
- **Do not run heavy checks locally that CI covers.** `pnpm lint` and
  `pnpm test` for changes under `src/`; add the cargo checks only when
  `src-tauri/**`, `package.json`, `pnpm-lock.yaml` or `.nvmrc` changed. Docs,
  site and copy changes need no cargo.
- **Review before pushing.** Review the diff and fix what it finds first, so CI
  runs once on a reviewed change.

## Testing conventions

- **Frontend:** Vitest + Testing Library in jsdom, tests in `src/test/`.
  `src/test/setup.ts` fakes Tauri `invoke`, including an in-memory store seeded
  via `window.__FAKE_TAURI_STORE__` and canned ACP responses. Agent profile
  fixtures are in `src/test/fixtures/agents.ts`. Vitest is configured with a
  20 s timeout and excludes `.claude/**` (agent worktree copies).
- **Rust:** `#[cfg(test)]` modules plus `src-tauri/tests/it/`, one binary. A new
  integration test file needs a `mod` line in `tests/it/main.rs`; a test checks
  that. Tests that set process-wide state get their own file under
  `src-tauri/tests/`, like `installer_state_test.rs`.
- **Fake ACP agent:** Rust ACP tests spawn
  `src-tauri/tests/fixtures/fake_acp_agent.mjs` with Node, so Node must be on
  PATH. Flags add capabilities on top of its defaults:
  `FAKE_ACP_RESUME`, `FAKE_ACP_LIST`, `FAKE_ACP_LIST_PAGES`,
  `FAKE_ACP_LIST_FAIL_AT`, `FAKE_ACP_CALL_LOG`, `FAKE_ACP_SLOW_REPLAY`,
  `FAKE_ACP_WRITE_FILES`, `FAKE_ACP_SETUP_METHOD`, `FAKE_ACP_MODELS`,
  `FAKE_ACP_QUESTION_LOG`.
- **Contract test:** `src/test/tauri-contract.test.ts` reads both sides' source
  and checks every `invoke('name', { keys })` against `generate_handler!` and
  every event against its emit/listen sites. When it fails after you add a
  command, argument or event, fix the name/key or the table — not the check. It
  does not check argument types or values.
- **Design-system tests:** `design-tokens.test.ts`, `design-system-docs.test.ts`,
  `theme-contrast.test.ts`, `site.test.tsx` and `xterm-release-build.test.ts`
  enforce rules that are easy to break. Keep them green.

## CI and releases

- **CI** (`.github/workflows/ci.yml`): frontend job runs `pnpm lint`,
  `pnpm test`, `pnpm build`; site job runs
  `pnpm --filter zorvo-site build` with a localhost `SITE_URL`.
- **Rust CI** (`rust.yml`) runs `cargo fmt`, `clippy -D warnings` and
  `cargo test` on a macOS runner, on every push to `main` and on pull requests
  that touch `src-tauri/` or build inputs. `security.yml` runs `pnpm audit` and
  `cargo audit`; Dependabot proposes weekly updates.
- **Releases:** bump the version in `package.json`, `src-tauri/Cargo.toml` and
  `src-tauri/tauri.conf.json`; roll `CHANGELOG.md`; push a `vX.Y.Z` tag. The
  Release workflow builds a universal macOS app and publishes nothing. Then, on
  the maintainer's Mac, in a clean checkout of the tag, run
  `node scripts/sign-release.mjs vX.Y.Z` with `node` (not via `pnpm run`, which
  puts `node_modules/.bin` first on PATH). The signing key lives at
  `~/.tauri/zorvo-updater.key`; never create, read or print it. See
  `docs/development.md` for the full release and `--dry-run` behavior.
- **Supply chain:** `pnpm-workspace.yaml` enforces `minimumReleaseAge` (one
  week), `blockExoticSubdeps` and `trustPolicy: no-downgrade`. Do not weaken
  these settings without an explicit decision.

## Working in worktrees and keeping disk use down

Parallel sessions may each work in their own git worktree. On the maintainer's
Mac an untracked `.cargo/config.toml` at the repo root sets
`[build] target-dir = "/Users/mac/Library/Caches/zorvo-target"`, shared by every
worktree. Leave it alone: `git clean -x` removes it, and every worktree would
silently go back to its own `target`. `pnpm clean:rust` empties the shared
folder, so do not run it while another session builds.

`node_modules` costs little in a worktree (pnpm clones from its store on APFS);
the Rust `target` folder is the real disk cost. Without the shared config, each
checkout builds its own `target`.

## Documentation map

| Document | Use it for |
|---|---|
| `README.md` | What Zorvo does, install, agents, privacy, troubleshooting |
| `CLAUDE.md` | Deep architecture reference (the most detailed source) |
| `docs/development.md` | How it works, checks, release process, roadmap |
| `CONTRIBUTING.md` | Setup, change workflow, ground rules |
| `docs/design-system/README.md` | Tokens, type, color, space, copy rules |
| `CHANGELOG.md` | User-visible changes per release; add under `Unreleased` |
| `SECURITY.md` | How to report a vulnerability privately |

## Ground rules for changes

1. Read the relevant code, tests and docs before editing; do not guess at
   conventions.
2. Prefer editing existing files; keep new abstractions rare and justified.
3. Validate at system boundaries, handle errors explicitly, and never silently
   swallow them.
4. Never bypass path checks, download-hash checks or the UI/backend trust
   boundary to make a test pass.
5. Run the checks the change needs, and report failures honestly rather than
   claiming success.