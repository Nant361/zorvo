# Installing npx agents into Zorvo's own folder

Date: 2026-11-16
Status: implemented in zakyirsyaad/zorvo#228

## Problem

An agent the registry distributes as an npm package (most entries, among them
Qwen Code, Codex and Claude Agent) is started as `npx -y <package>@<version>
<args>` on every launch (`registry/resolve.rs`, `Distribution::Npx`). **Install**
and **Update** only make sure Node.js is there; the plan has no step for the
package itself (`PlannedStep` is `Runtime`, `Agent` for a binary archive, and
`Prerequisite`).

So the package is downloaded by `npx` inside the first session's `initialize`:

- The session reads "{Agent} is working" for up to 180 s (`HANDSHAKE_TIMEOUT`)
  with no sign that about 150 MB is being downloaded, and after 60 s the stall
  notice offers Stop, which kills the download.
- A draft's probe and a session start run `npx` for the same version at the same
  time, with nothing between them. On 2026-11-16 this left
  `~/.npm/_npx/<hash>/` for Qwen Code 0.27.0 without a `package.json`, and every
  later start failed with npm's `ENOENT` until the folder was deleted by hand.
  Zorvo has no way to notice or repair that.
- Every start asks the npm registry about the package first (0.3 to 4 s in the
  npm logs of that day), although the version is pinned and already on disk.

## Goal

The package of an npx agent is downloaded when the user installs or updates the
agent, with progress and Cancel, into a folder Zorvo owns. Starting the agent
runs a local file and touches no network.

Success looks like:

- A first session of a freshly installed npx agent opens as fast as a later one.
- With the network off, an installed npx agent still starts.
- Two starts of the same agent at once cannot damage its install.
- An interrupted install leaves nothing a later start can trip over.

## Decisions made with the user

- After a Zorvo update, npx agents that are in use are installed automatically
  in the background when Zorvo opens. Until that finishes an agent reads
  Installing and cannot start a session.
- No fallback to `npx`: the old launch path is removed for agents.

## Out of scope

- uvx agents (two entries) keep running through `uvx`.
- The other shortcomings found the same day: raw npm output in the start
  failure notice, the draft's model list that cannot be refreshed, the dead
  session a failed start leaves, and "is working" during start. Each is its own
  change.
- `--ignore-scripts`. Dependency install scripts run today under `npx` and keep
  running; turning them off may break agents with native modules and is a
  separate decision.
- Cleaning the user's `~/.npm/_npx`.

## Design

### 1. A plan step for the package

`PlannedStep` gets a fourth variant:

```rust
NpmAgent { id: String, name: String, version: String, package: String }
```

`package` is the registry's pinned spec (`@qwen-code/qwen-code@0.27.0`), already
validated by `registry/schema.rs`. `steps_for` emits it when the entry is
`Distribution::Npx` and the resolver found no installed copy. Order stays
runtime, prerequisites, agent.

Its display (`InstallStep`) follows the prerequisite's: the agent's name, the
npm phase, no byte counts (npm reports none).

### 2. Installing

`Installer::install_npm_agent` mirrors `install_prerequisite`:

1. Return at once when `tools/agents/<id>/<version>/install.json` exists.
2. Pick npm with `npm_for`'s rule (the user's when their Node is new enough,
   else Zorvo's). `npm_for` takes a `Prerequisite` today only for its error
   text; it is changed to take the name to mention.
3. `npm install -g --prefix <staging content> --no-audit --no-fund <package>`
   through `run_npm_install`, with `NPM_INSTALL_TIMEOUT` and the job's cancel
   flag.
4. Choose the bin (below). No bin, or an ambiguous one, fails the step and the
   staging folder is dropped.
5. `commit` into `tools/agents/<id>/<version>/` with a record whose `source` is
   `npm:<package>` and whose `bin` is `bin/<name>`, relative to the install dir.

`npm_install_args` is generalised to take the package spec instead of a
`Prerequisite`.

The step runs under the same per-target lock as the others (`lock_key`), so two
jobs for the same agent and version cannot install at once.

**Choosing the bin.** After the install, `<prefix>/bin/` holds one link per bin
of the package. The rule is npx's own: the only entry (names that all link to one file, as Kilo's
`kilo` and `kilocode` do, count as one, and the first by name is taken), else the entry named like
the package without its scope (`qwen-code` for `@qwen-code/qwen-code`).
Otherwise the step fails with "{Agent}'s package has no program Zorvo can pick."
The name must be a single path part (`is_single_name`). The choice is a pure
function over the list of names, unit-tested.

Links in `bin/` are relative (`../lib/node_modules/...`), so the rename out of
staging keeps them valid. A test asserts this on a real install.

### 3. Resolving and launching

`InstalledTools` (`installer/plan.rs`) already scans `tools/agents/` into
`agents: (id, version) -> dir`. It also reads each dir's record, so the resolver
knows the recorded `bin`.

For `Distribution::Npx`, `resolve` becomes:

- No Node usable (neither the user's from `MIN_USER_NODE_MAJOR` on, nor
  Zorvo's): `Program::NeedsRuntime`, as today.
- Node usable and an install with a record and a `bin`: `Program::Found` with
  the path `<dir>/<bin>`, and Zorvo's Node bin dir prepended to `PATH` when
  Zorvo's Node is the one in use (the bin's shebang is `#!/usr/bin/env node`).
- Node usable, no install: `Program::NotInstalled`.

`args` becomes the entry's own arguments, without `-y <package>`; `setup_args`
becomes empty. `command` stays `"npx"` only as the profile's kind label where
the UI shows it; nothing runs `npx` for an agent.

`AgentProfile`, `launch_for`, terminal sign-in and agent setup read the resolved
program and args and need no change of their own.

`installed_on_system` (the user's global npm package) stays what it is today: a
fact the catalog shows. It does not make the agent ready.

### 4. Installing automatically at start

The webview drives it, because the install store (`lib/agent-installs.ts`) only
shows a job it started itself: a progress event for an agent whose entry is not
`installing` is dropped. A job begun by the backend would be invisible and could
not be cancelled.

A hook mounted by `App` (main window only), `useAutoInstall`, runs once per app
run when the catalog has loaded:

- It takes the agents in use whose status is `not_installed` and whose plan is
  exactly one npm-agent step. An agent that also needs a runtime or a
  prerequisite was not ready before this change either and keeps its Install
  button. The selection is a pure function in `lib/agent-catalog.ts`.
- It installs them one at a time with `startInstall`, the Install button's own
  path, so progress, Cancel and failure wording are the existing ones.
- A failed or cancelled install is not retried in that run; the row offers
  Install, and the next start of Zorvo tries again.
- It never runs in onboarding, where ticking an agent already offers Install.

The catalog row and the sidebar chip then read Installing as for any install,
and the new-session draft already blocks Send for an agent that needs an install
(`draftNeedsInstall`).

No backend command is added: `install_agent` rebuilds the plan from the agent id
as it does for a click.

### 5. Update, removal, clean-up

- `update_agent` plans for the target version, so the new package is installed
  before the webview records the version. Nothing new.
- `remove_agent_install` and the start clean-up work on `tools/agents/<id>/`
  dirs whatever made them. Nothing new.
- A cancelled or failed install leaves only a staging folder, which the start
  clean-up already removes.

### 6. Network and privacy

Starting an npx agent no longer contacts the npm registry. Installing one
downloads from the npm registry, as `npx` did.

New: the automatic install at start downloads without a click, once per agent
and version. The README's privacy section and the project rule in `CLAUDE.md`
that lists the backend's requests are updated to say so.

### 7. Errors

- npm failures reach the UI as a prerequisite's do today (`NpmError` into
  `StepError`), with the same wording.
- A record without a `bin`, or a `bin` whose file is gone, resolves as
  `NotInstalled`, so Install repairs it.

## Risks

- **One-time wait after the update.** A user with three npx agents waits for
  three downloads before those agents start. The rows say Installing; other
  agents are unaffected.
- **Disk.** About 150 to 270 MB per npx agent under the app data dir. Old
  versions are removed by the existing clean-up.
- **Node changes under an install.** A package with native prebuilds is
  installed with one Node and may later run with another (the user upgrades
  theirs). The same is true of `npx`'s cache today. Not addressed.
- **A package whose bin differs from npx's choice.** The rule is npx's, so an
  agent that works today picks the same program. The integration test covers
  the two cases (single bin, bin named like the package).

## Testing

Rust, unit:

- Bin choice: single bin, named like the unscoped package, ambiguous, none, a
  name with a path separator.
- `steps_for`: an npx entry with Node and no install plans one `NpmAgent`;
  without Node, `Runtime` then `NpmAgent`; with an install, nothing.
- `resolve`: program path and `PATH` for the user's Node and for Zorvo's; args
  without `-y <package>`; a record without `bin` is not installed.

Rust, integration (`tests/it/`, new file with its `mod` line):

- Install a tiny package from a local tarball (`npm pack` of a fixture dir, so
  no network), then launch it through the resolved program and get its output.
- Cancel mid-install leaves no agent dir.
- Two installs of the same agent at once: one runs, the result is one valid dir.
- The fake ACP agent, packaged the same way, answers `initialize` when started
  from its install.

Frontend:

- The selection: in use, `not_installed`, a plan of exactly one npm-agent step.
- `useAutoInstall` installs the selected agents one at a time, once per run,
  and does not retry a failure.
- `tauri-contract.test.ts` passes (no new command or event).

## Files

- `src-tauri/src/installer/plan.rs`: the `NpmAgent` step, records in the scan.
- `src-tauri/src/installer/install.rs`: `install_npm_agent`, `npm_for`'s
  parameter, `lock_key`, `has_plain_path_parts`.
- `src-tauri/src/installer/prerequisites.rs`: `npm_install_args` by spec.
- `src-tauri/src/installer/npm_bin.rs` (new): the bin choice.
- `src-tauri/src/registry/resolve.rs`: the npx branch of `resolve` and
  `steps_for`; `npx_program` goes.
- `src/hooks/useAutoInstall.ts` (new), `src/lib/agent-catalog.ts`, `src/App.tsx`.
- `src-tauri/src/registry/schema.rs`: an npx entry's version must be one plain name, since it now
  names the install dir.

The step is shown with the existing `agent` kind and the `npm` phase, so
`src/lib/install-plan.ts` needed no change.
- `README.md`, `CLAUDE.md`, `CHANGELOG.md`.
