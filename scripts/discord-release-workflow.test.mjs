import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The Discord release post holds a repository secret (the webhook URL), and any workflow in the repository can read
// one. So this workflow stays as small as it can: it runs only for a published release, runs no project code, and
// asks for no token permissions. A draft made by scripts/sign-release.mjs, or a prerelease, posts nothing.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/discord-release.yml"), "utf8");
const code = WORKFLOW.replace(/^[ \t]*#.*$/gm, "");

/** The `on:` block, up to the next top-level key. */
const onBlock = code.slice(code.indexOf("\non:\n") + 1).split(/\n(?=\S)/)[0];
/** The text of every `run:` block (the lines indented below `run: |`). */
const runBlocks = [...code.matchAll(/^( +)run: \|\n((?:\1 +.*\n?|\s*\n)*)/gm)].map((match) => match[2]);

describe("the Discord release workflow", () => {
  it("runs only when a release is published", () => {
    expect(onBlock.replace(/\s+/g, " ").trim()).toBe("on: release: types: [published]");
  });

  it("skips prereleases", () => {
    expect(code).toMatch(/if: .*!github\.event\.release\.prerelease/);
  });

  it("has no permissions", () => {
    expect(code).toMatch(/^permissions: \{\}$/m);
  });

  it("uses one secret, the webhook", () => {
    const secrets = new Set([...code.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]));
    expect([...secrets]).toEqual(["DISCORD_RELEASES_WEBHOOK"]);
  });

  it("runs no project code", () => {
    for (const word of ["actions/checkout", "pnpm", "npm ", "node "]) expect(code).not.toContain(word);
  });

  it("passes event text through the environment, never inline in a script", () => {
    expect(runBlocks.length).toBeGreaterThan(0);
    for (const block of runBlocks) expect(block).not.toContain("${{");
  });
});
