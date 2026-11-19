# AGENTS.md

Instructions for coding agents that read `AGENTS.md` (Codex, Antigravity and
others) when working in this repository.

## Read first

- `CLAUDE.md` is the full reference: architecture, commands, testing
  conventions and project rules. Its rules apply to every agent, not only
  Claude Code. Read it before you change code.
- `docs/development.md` covers the build, the checks and the release.

## Design system

Zorvo's design system lives in `docs/design-system/`. Follow it for any
interface work, and for any page, mockup or diagram you make for this project.

- `docs/design-system/README.md` first: color, type, space, shape, states,
  icons and how the product writes.
- `docs/design-system/tokens.json`: every color, type style, space, radius,
  shadow and size, with a usage note each. Use these names and values; never
  invent a color.
- `docs/design-system/components/<Name>/README.md`: each component's
  guideline.

There is also a published copy on claude.ai, made from this folder. Only
Claude can open it, so read the folder here; it is the source.

In app code the tokens come from `src/styles/globals.css` as Tailwind
utilities (`bg-surface-2`, `text-fg-muted`, `border-border-strong`). Never
write a raw color (`bg-neutral-800`, `text-white`, `bg-[#121212]`); tests fail
on them. Change `globals.css` and `tokens.json` together; a test fails when
they drift.

## Working here

- Run only what the change needs: `pnpm lint` and the Vitest files your change
  touches for `src/`; `cargo fmt --check`, `cargo clippy --all-targets -- -D
  warnings` and `cargo test` (from `src-tauri/`) only when `src-tauri/`
  changed. CI runs everything.
- Other sessions may share this checkout. Stage files by path; never
  `git add -A` or `git add .`.
- Conventional Commits (`feat:`, `fix:`, `docs:`, …) on `feat/…`, `fix/…` or
  `chore/…` branches. Add a line under `Unreleased` in `CHANGELOG.md` for a
  change users can see.
- Zorvo never asks for or stores API keys or tokens, and its webview makes no
  network request. Keep it that way.
