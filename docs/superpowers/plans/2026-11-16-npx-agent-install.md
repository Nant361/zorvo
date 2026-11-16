# Installing npx Agents Into Zorvo's Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An npx agent's npm package is installed into `tools/agents/<id>/<version>/` on Install and Update, and a session starts it from there instead of through `npx -y`.

**Architecture:** A fourth `PlannedStep`, `NpmAgent`, runs the same `npm install -g --prefix <staging>` the Pi prerequisite uses and records the chosen bin in `install.json`. The resolver treats an npx entry like a binary one: `Found` when an install with a recorded bin exists, else `NotInstalled`. A webview hook installs in-use npx agents once per run through the Install button's own path.

**Tech Stack:** Rust (Tauri 2 backend, crate `zorvo`), TypeScript + React 19, Vitest, npm.

**Spec:** `docs/superpowers/specs/2026-11-16-npx-agent-install-design.md`

## Global Constraints

- Only `Distribution::Npx` changes. `Uvx` and `Binary` behave exactly as before.
- No fallback to `npx`: after this change nothing in `src-tauri/src` runs `npx` to start an agent.
- The UI still sends only an agent id; the package spec comes from the registry entry in the backend.
- `npm install` arguments are exactly `install -g --prefix <dir> --no-audit --no-fund <spec>`. No `--ignore-scripts`.
- Install dir: `tools/agents/<id>/<version>/`; record `source` is `npm:<spec>`; record `bin` is `bin/<name>`, relative to that dir.
- No new Tauri command and no new event (`src/test/tauri-contract.test.ts` must pass untouched).
- The step's display kind stays `"agent"`, so `InstallStep.kind` in `src/types/index.ts` and `src/lib/install-plan.ts` do not change. (The spec listed `install-plan.ts`; it turned out not to need a new kind, since the `npm` phase line already exists.)
- No raw colors, sentence-case copy, agents named by name (project design rules).
- Rust checks for every task that touches `src-tauri/**`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and the task's tests. Frontend: `pnpm lint` and the task's Vitest files only (the full suite runs in CI).
- Stage explicit paths; never `git add -A`. Conventional Commits.

## Review Focus

1. A package whose `bin/` holds several programs, none named like the package: the install must fail with a sentence and leave no agent dir. (Task 1, Task 2)
2. An install dir whose `install.json` has no `bin`, or whose bin file is gone (a binary agent's record, a half-deleted dir): the agent must read as not installed, not start a missing file. (Task 3)
3. The user's Node is too old and Zorvo's Node is not installed: an npx agent must still read "needs runtime", and its plan must be Node first, then the package. (Task 3)
4. Cancel during the npm step: no agent dir, empty staging, and a later Install works. (Task 2)
5. The automatic install must not start for an agent the user is installing by hand at that moment, and must not retry a failure in the same run. (Task 4)

---

### Task 1: Choosing the package's program

**Files:**
- Create: `src-tauri/src/installer/npm_bin.rs`
- Modify: `src-tauri/src/installer/mod.rs` (add `pub mod npm_bin;`)

**Interfaces:**
- Produces: `pub fn choose_bin(spec: &str, bins: &[String]) -> Option<String>` and `pub fn unscoped_name(spec: &str) -> &str`.

- [ ] **Step 1: Write the failing tests** in a `#[cfg(test)]` module of `npm_bin.rs`

```rust
fn names(list: &[&str]) -> Vec<String> { list.iter().map(|s| s.to_string()).collect() }

#[test] fn the_only_bin_is_chosen() {
    assert_eq!(choose_bin("@qwen-code/qwen-code@0.27.0", &names(&["qwen"])), Some("qwen".into()));
}
#[test] fn among_several_the_one_named_like_the_package_is_chosen() {
    assert_eq!(choose_bin("@scope/tool@1.0.0", &names(&["helper", "tool"])), Some("tool".into()));
    assert_eq!(choose_bin("tool@1.0.0", &names(&["tool", "x"])), Some("tool".into()));
}
#[test] fn several_bins_with_none_named_like_the_package_choose_nothing() {
    assert_eq!(choose_bin("@scope/tool@1.0.0", &names(&["a", "b"])), None);
}
#[test] fn no_bin_chooses_nothing() { assert_eq!(choose_bin("tool@1.0.0", &[]), None); }
#[test] fn a_name_with_a_path_part_is_never_chosen() {
    assert_eq!(choose_bin("tool@1.0.0", &names(&["../tool"])), None);
    assert_eq!(choose_bin("tool@1.0.0", &names(&["a/b"])), None);
}
#[test] fn the_unscoped_name_drops_scope_and_version() {
    assert_eq!(unscoped_name("@qwen-code/qwen-code@0.27.0"), "qwen-code");
    assert_eq!(unscoped_name("tool@1.0.0"), "tool");
    assert_eq!(unscoped_name("tool"), "tool");
    assert_eq!(unscoped_name("@scope/tool"), "tool");
}
```

- [ ] **Step 2: Run** `cargo test --lib npm_bin` from `src-tauri/`. Expected: compile error, functions not defined.

- [ ] **Step 3: Implement both functions.** A name counts only when it is one plain path component (same rule as `is_single_name` in `install.rs`; make that function `pub(super)` and reuse it). `unscoped_name` drops a version after the last `@` that is not the first character, then everything up to the last `/`.

- [ ] **Step 4: Run** `cargo test --lib npm_bin`. Expected: 6 passed.

- [ ] **Step 5: Commit** `feat: choose an npm package's program the way npx does` (`npm_bin.rs`, `mod.rs`, `install.rs`).

---

### Task 2: The npm-agent step and its install

**Files:**
- Modify: `src-tauri/src/installer/plan.rs` (`PlannedStep`, `display`)
- Modify: `src-tauri/src/installer/prerequisites.rs` (`npm_install_args`)
- Modify: `src-tauri/src/installer/install.rs` (`run_step`, `install_npm_agent`, `npm_for`, `lock_key`, `has_plain_path_parts`)
- Test: `src-tauri/tests/it/installer_install_test.rs`, `src-tauri/tests/it/installer_prerequisites_test.rs`, `src-tauri/tests/it/installer_plan_test.rs`

**Interfaces:**
- Consumes: `choose_bin` from Task 1.
- Produces:
  - `PlannedStep::NpmAgent { id: String, name: String, version: String, package: String }`; `display` gives `InstallStep { kind: "agent", name, version, download_bytes: None }`.
  - `pub fn npm_install_args(prefix: &Path, spec: &str) -> Vec<OsString>`; the prerequisite caller passes `format!("{}@{}", p.package, p.version)`.
  - `fn npm_for(&self, name: &str, env, user_node_major)`; `name` is what the two error sentences mention (`p.command` for a prerequisite, the agent's name here).
  - An installed dir whose record is `InstallRecord { source: "npm:<package>", sha256: None, bin: Some("bin/<chosen>") }`.

- [ ] **Step 1: Write the failing tests** in `installer_install_test.rs`. Add a second fake npm next to `FAKE_NPM`:

```rust
/// An `npm` that installs the programs named in `$FAKE_BINS` (space separated) under `--prefix`.
const FAKE_NPM_BINS: &str = r#"#!/bin/sh
while [ $# -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then prefix="$2"; fi
  last="$1"; shift
done
/bin/mkdir -p "$prefix/bin"
printf '%s' "$last" > "$prefix/spec.txt"
for b in $FAKE_BINS; do printf '#!/bin/sh\necho ok\n' > "$prefix/bin/$b"; /bin/chmod +x "$prefix/bin/$b"; done
"#;
```

Tests (user npm on `PATH` with `user_node_major: Some(24)`, as `a_prerequisite_uses_the_users_npm_when_node_is_new_enough` does; `FAKE_BINS` goes in the env map passed to `run`):

  - `installs_an_npm_agent_and_records_its_program`: step `NpmAgent { id: "fake", name: "Fake", version: "1.0.0", package: "@scope/fake@1.0.0" }`, `FAKE_BINS=fake`. Assert: `ToolsDir::agent_dir("fake","1.0.0")` has a record with `source == "npm:@scope/fake@1.0.0"`, `bin == Some("bin/fake")`, `sha256 == None`; `dest/bin/fake` is a file; `dest/spec.txt` is `@scope/fake@1.0.0`; one progress event has `phase == "npm"`, `kind == "agent"`, `name == "Fake"`.
  - `an_npm_agent_already_installed_is_skipped`: run twice with a fake npm that also appends a line to a counter file outside the prefix; the counter has one line.
  - `an_npm_agent_without_a_program_to_pick_installs_nothing`: `FAKE_BINS="a b"`. Assert the error is exactly `Fake's package has no program Zorvo can pick.`, the agent dir does not exist, `staging_is_empty`.
  - `cancelling_an_npm_agent_install_leaves_no_dir`: a fake npm that sleeps 5 s; cancel after the `npm` phase event; assert `Cancelled`, no agent dir, `staging_is_empty`, and a following run with the normal fake npm installs.
  - `an_npm_agent_without_any_node_fails`: no npm on `PATH`, `user_node_major: None`, no Node installed. Error: `Fake needs Node.js, which is not installed`.
  - `an_npm_agent_id_that_is_not_a_plain_name_installs_nothing`: `id: "../x"`. Error as for a binary agent (`its id or version is not a plain name`).
  - `a_real_npm_install_keeps_its_program_runnable_after_the_move`: skipped with an early `return` when `npm` is not found on the process `PATH`. Write a package dir (`package.json` with `"name": "zorvo-fixture-agent"`, `"version": "1.0.0"`, `"bin": {"zorvo-fixture-agent": "cli.js"}`; `cli.js` = `#!/usr/bin/env node\nconsole.log("fixture-ok")`), run `npm pack` in it, use the tarball's absolute path as `package`, run the step with the process environment. Assert running `dest/bin/zorvo-fixture-agent` prints `fixture-ok`.

  In `installer_prerequisites_test.rs` update the `npm_install_args` test to the new signature (same expected arguments). In `installer_plan_test.rs` add `an_npm_agent_step_displays_as_an_agent` asserting the `InstallStep` above.

- [ ] **Step 2: Run** `cargo test --test it installer_` from `src-tauri/`. Expected: compile errors for the missing variant and signature.

- [ ] **Step 3: Implement.**
  - `lock_key`: `NpmAgent { id, .. } => format!("agent:{id}")`. `has_plain_path_parts`: `is_single_name(id) && is_single_name(version)`.
  - `run_step` dispatches to `fn install_npm_agent(&self, id: &str, version: &str, package: &str, run: &StepRun, env: &HashMap<String, String>, user_node_major: Option<u32>) -> Result<(), StepError>`: return `Ok` when `read_record(dest)` is some; `npm_for(&run.name, …)`; new staging; `run.report(PHASE_NPM, 0, None)`; `run_npm_install` with `NPM_INSTALL_TIMEOUT` and `run.cancel`; list the file names in `<staging content>/bin` (a missing dir is an empty list); `choose_bin(package, &names)` or `StepError::Failed(format!("{}'s package has no program Zorvo can pick.", run.name))`; `commit` with `record(&format!("npm:{package}"), None, Some(&format!("bin/{chosen}")))`.
  - Staging is dropped on every early return (its `Drop` removes it), so no extra clean-up code.

- [ ] **Step 4: Run** `cargo test --test it installer_`, then `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`. Expected: all pass.

- [ ] **Step 5: Commit** `feat: install an npx agent's package into Zorvo's tools folder`.

---

### Task 3: Resolving and launching from the install

**Files:**
- Modify: `src-tauri/src/installer/plan.rs` (`InstalledTools`)
- Modify: `src-tauri/src/registry/resolve.rs`
- Test: `src-tauri/tests/it/registry_resolve_test.rs`, `src-tauri/tests/it/installer_plan_test.rs`

**Interfaces:**
- Consumes: the record shape from Task 2.
- Produces:
  - `InstalledTools.agent_bins: BTreeMap<(String, String), String>`: `(id, version)` to the record's `bin`, only for records that have one. Filled in `scan` beside `agents`.
  - For an npx entry: `acp_args` are the entry's own args (no `-y <package>`), `setup_args` is empty, `acp_program_path` is `<agent dir>/<bin>`.

- [ ] **Step 1: Write the failing tests** in `registry_resolve_test.rs` (reuse its existing entry and `SystemTools` builders; update the npx tests that assert `-y` and an `npx` path):

  - `an_npx_agent_with_an_install_runs_its_recorded_program`: `agents` and `agent_bins` hold `("qwen-code","0.27.0")` → dir, `"bin/qwen"`; the bin file exists on disk; user Node 24. Assert `availability == "ready"`, `acp_program_path == Some("<dir>/bin/qwen")`, `acp_args == entry args`, `setup_args` empty, `acp_path_prepend` empty, `install_plan == None`.
  - `an_npx_agent_on_zorvos_node_gets_that_node_first_on_path`: no usable user Node, `installed.node` set. Assert `acp_path_prepend == [node bin dir]`.
  - `an_npx_agent_without_an_install_is_not_installed`: Node usable, no install. Assert `availability == "not_installed"`, `install_plan` is one step `{ kind: "agent", name: <entry name>, version: <entry version> }`, and `planned_steps` is `[NpmAgent { id, name, version, package: <entry package> }]`.
  - `an_npx_agent_without_node_needs_the_runtime_first`: user Node 18, no Zorvo Node. Assert `availability == "needs_runtime"` and `planned_steps == [Runtime(Node), NpmAgent { .. }]`.
  - `an_npx_install_without_a_recorded_program_is_not_installed`: `agents` has the dir, `agent_bins` does not. `not_installed`.
  - `an_npx_install_whose_program_is_gone_is_not_installed`: `agent_bins` set, file missing. `not_installed`.
  - `an_installed_npx_agent_is_by_zorvo_even_with_a_global_package`: `npm_globals` contains the package. `install_status == InstallStatus::ByZorvo`; without an install it is `NotInstalled`.
  - `a_missing_npx_agent_says_it_is_not_installed`: `missing_reason` is `"<Name> is not installed"` (no "npx was not found on PATH").
  - `uvx_and_binary_agents_resolve_as_before`: the existing uvx and binary tests stay green unchanged.

  In `installer_plan_test.rs`: `scan_reads_each_agents_recorded_program` (one dir with `bin: Some("bin/x")`, one with `None`; only the first is in `agent_bins`).

- [ ] **Step 2: Run** `cargo test --test it registry_resolve_test:: installer_plan_test::`. Expected: failures on the new assertions.

- [ ] **Step 3: Implement.**
  - Replace `npx_program` with `fn npm_agent_program(entry: &RegistryEntry, tools: &SystemTools) -> (Program, Option<RuntimeKind>)`: keep today's Node choice (user's Node when usable and `npx` or `node` is found on `PATH`, else Zorvo's, else `NeedsRuntime(tools.locate("npx"))`); with a Node, look up `(entry.id, entry.version)` in `agents` and `agent_bins`, join them, and return `Found` only when that path is a file, else `NotInstalled`. `prepend` is Zorvo's Node bin dir when Zorvo's Node is the one in use. `zorvo_runtime` is `Some(Node)` exactly when it is today.
  - `resolve`: for `Npx`, `args` = entry args, `setup_args` = `Vec::new()`. `command` stays `"npx"` (it is the profile's kind label and `cleanup_inputs` reads `distribution`).
  - `steps_for`: emit `PlannedStep::NpmAgent` when the entry is `Npx` and the program is `NotInstalled`, **or** `NeedsRuntime` (the package is missing too until installed; check `agents`/`agent_bins` the same way, so an installed package under a missing Node plans only the runtime).
  - `install_status`: for kind `"npx"` a ready agent is `ByZorvo`; `installed_on_system` leads to `OnYourMac` only for the other kinds.
  - `missing_reason`: for `Some("npx")` and `AVAILABILITY_NOT_INSTALLED` with no missing prerequisite, `format!("{} is not installed", profile.name)`.

- [ ] **Step 4: Run** the two test modules, then `cargo test` (whole Rust suite: the ACP tests launch fake agents through profiles), `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`. Expected: all pass. `grep -rn '"-y"' src-tauri/src` finds nothing.

- [ ] **Step 5: Commit** `feat: start an npx agent from its install instead of npx`.

---

### Task 4: Installing in-use npx agents when Zorvo opens

**Files:**
- Modify: `src/lib/agent-catalog.ts`
- Create: `src/hooks/useAutoInstall.ts`
- Modify: `src/App.tsx` (mount the hook beside `useAgentUpdates`)
- Test: `src/test/agent-catalog.test.ts` (or the file that already tests `rowActions`), `src/test/use-auto-install.test.tsx`

**Interfaces:**
- Consumes: `startInstall`, `installEntryOf`, `subscribeToInstalls` from `src/lib/agent-installs.ts`; `AgentProfile.install_plan`, `.distribution`, `.availability`.
- Produces:
  - `export function autoInstallTargets(agentsInUse: readonly AgentProfile[]): string[]`: ids, in the given order, of agents with `distribution === 'npx'`, `availability === 'not_installed'` and an `install_plan` of exactly one step whose `kind === 'agent'`.
  - `export function useAutoInstall(options: { agentsInUse: readonly AgentProfile[]; isReady: boolean }): void`.

- [ ] **Step 1: Write the failing tests.**

  `autoInstallTargets`:
  - an npx agent, `not_installed`, plan `[agent]` → included;
  - plan `[node, agent]` → excluded; plan `[prerequisite, agent]` → excluded; plan `null` → excluded;
  - `availability: 'ready'` → excluded; `distribution: 'binary'` or `'uvx'` with plan `[agent]` → excluded;
  - order follows the input.

  `useAutoInstall` (mock `../lib/agent-installs`):
  - `isReady: false` starts nothing; turning it true starts the first target only;
  - when the first target's entry leaves `installing` (idle or failed), the second starts; a failed one is not started again;
  - a target whose entry is already `installing` when its turn comes (the user clicked Install) is skipped, not started twice;
  - a rerender with a new `agentsInUse` array after the run began starts nothing more (once per app run);
  - unmount unsubscribes.

- [ ] **Step 2: Run** `pnpm vitest run src/test/use-auto-install.test.tsx src/test/agent-catalog.test.ts`. Expected: fail, not defined.

- [ ] **Step 3: Implement.** The hook takes the targets once, the first time `isReady` is true (a ref guards the run), keeps the queue in a ref, and advances from a `subscribeToInstalls` callback: when the current id's entry is no longer `installing`, pop the next id whose entry is not `installing` and call `startInstall`. No state, no render output.

  In `App.tsx`: `useAutoInstall({ agentsInUse, isReady: isLoaded && state.settings.onboardingCompleted && <the profiles-loaded flag from useAgentProfiles> })`. Use the flag `useAgentProfiles` already returns for "profiles loaded"; if it returns none, add `isLoaded` to its result rather than inferring from `agents.length`.

- [ ] **Step 4: Run** the two test files and `pnpm lint`. Expected: pass, no warnings.

- [ ] **Step 5: Commit** `feat: install in-use npx agents once when Zorvo opens`.

---

### Task 5: Documentation and the whole-branch check

**Files:**
- Modify: `README.md` (privacy section), `CLAUDE.md` (Project rules: the backend's network requests; Installer and Agent profiles paragraphs), `CHANGELOG.md` (`Unreleased`), `docs/development.md` if it describes how npx agents start.

- [ ] **Step 1: Edit the docs.** Facts to state, in the project's wording style:
  - An npx agent's package is installed under the app data dir's `tools/agents/` on Install and Update, with `npm install`, and a session starts it from there; `npx` is no longer run for agents.
  - Starting an agent makes no request to the npm registry.
  - When Zorvo opens, an agent in use whose only missing part is its npm package is installed without a click, once per run; this downloads from the npm registry.
  - Changelog line under `Unreleased` → `Changed`: "Agents that come as npm packages are now downloaded when you install or update them, not when the first session starts. After this update Zorvo installs the ones you use once, in the background."

- [ ] **Step 2: Run the branch checks.** From `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`. From the root: `pnpm lint`, `pnpm vitest run src/test/tauri-contract.test.ts src/test/use-auto-install.test.tsx src/test/agent-catalog.test.ts`. Expected: all pass.

- [ ] **Step 3: Try it in the real app.** `pnpm tauri dev` with a scratch `HOME`, so the real app data is untouched: with Qwen Code in use and no `tools/agents/qwen-code/`, the row reads Installing, then the agent starts a session; a second session starts with the network off.

- [ ] **Step 4: Commit** `docs: say where npx agents are installed and when Zorvo downloads them`.
