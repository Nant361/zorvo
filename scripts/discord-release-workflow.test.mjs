import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The Discord release post holds a repository secret (the webhook URL), and any workflow in the repository can read
// one. So this workflow stays as small as it can: it runs only for a published release, runs no project code, and
// asks for no token permissions. It listens to `released`, which GitHub sends when a release is published and when a
// prerelease is later marked as a release; a draft made by scripts/sign-release.mjs, or a prerelease, posts nothing.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/discord-release.yml"), "utf8");

/** Every way `text` breaks the rules above, as short sentences; empty when it keeps them. */
function problemsOf(text) {
  const code = text.replace(/^[ \t]*#.*$/gm, "");
  const problems = [];
  const onBlock = code.slice(code.indexOf("\non:\n") + 1).split(/\n(?=\S)/)[0];
  if (onBlock.replace(/\s+/g, " ").trim() !== "on: release: types: [released]") problems.push("trigger");
  // The one `if:` is the job-level prerelease guard, exactly.
  const ifs = code.match(/^[ \t]*if:.*$/gm) ?? [];
  if (ifs.length !== 1 || ifs[0] !== "    if: ${{ !github.event.release.prerelease }}") problems.push("prerelease");
  // Exactly one `permissions:` line, the empty top-level one: a job-level grant would add a second.
  const permissions = code.match(/^[ \t]*permissions:.*$/gm) ?? [];
  if (permissions.length !== 1 || permissions[0] !== "permissions: {}") problems.push("permissions");
  // Any `secrets.X` or `secrets['X']`, so bracket syntax cannot read another secret unseen.
  const secrets = new Set([...code.matchAll(/secrets\s*(?:\.|\[\s*['"])([A-Za-z0-9_]+)/g)].map((match) => match[1]));
  if (JSON.stringify([...secrets]) !== JSON.stringify(["DISCORD_RELEASES_WEBHOOK"])) problems.push("secrets");
  for (const word of ["actions/checkout", "pnpm", "npm ", "node "]) if (code.includes(word)) problems.push(`runs ${word}`);
  // One step, no actions: nothing but the one shell step runs next to the secret.
  if ((code.match(/^[ \t]+- (?:name|uses|run):/gm) ?? []).length !== 1 || /^[ \t]+-?[ \t]*uses:/m.test(code)) problems.push("steps");
  // An expression may only be an env value or the job's prerelease guard, never inside a script of any run form.
  // Read from the raw text: GitHub expands `${{ }}` on a `#` line inside a script too, before the shell sees it.
  const allowed = [/^[ \t]+[A-Z_]+: \$\{\{ [^}]+ \}\}$/, /^[ \t]+if: \$\{\{ !github\.event\.release\.prerelease \}\}$/];
  for (const line of text.split("\n").filter((l) => l.includes("${{"))) {
    if (!allowed.some((pattern) => pattern.test(line))) problems.push(`expression outside env: ${line.trim()}`);
  }
  return problems;
}

/** The workflow with `line` added as a new last line of the post step. */
const withStepLine = (line) => WORKFLOW.replace("      - name: Post to Discord\n", `      - name: Post to Discord\n${line}\n`);

/** The rule names `text` breaks, without the detail an expression problem carries. */
const rulesBroken = (text) => problemsOf(text).map((problem) => problem.split(":")[0]);

describe("the Discord release workflow", () => {
  it("keeps every rule", () => {
    expect(problemsOf(WORKFLOW)).toEqual([]);
  });

  it("would be caught running for anything but a release", () => {
    expect(rulesBroken(WORKFLOW.replace("types: [released]", "types: [released, created]"))).toContain("trigger");
  });

  it("would be caught moving or weakening the prerelease guard", () => {
    const weakened = WORKFLOW.replace("!github.event.release.prerelease }}", "!github.event.release.prerelease || true }}");
    expect(rulesBroken(weakened)).toContain("prerelease");
  });

  it("would be caught hiding an expression in a script comment", () => {
    const mutated = WORKFLOW.replace("        run: |\n", "        run: |\n          # ${{ github.event.release.body }}\n");
    expect(rulesBroken(mutated)).toContain("expression outside env");
  });

  it("would be caught putting event text inline in a one-line run", () => {
    const mutated = WORKFLOW.replace(
      "      - name: Post to Discord\n",
      '      - name: Echo\n        run: echo "${{ github.event.release.name }}"\n      - name: Post to Discord\n',
    );
    expect(rulesBroken(mutated)).toContain("expression outside env");
  });

  it("would be caught granting the job permissions", () => {
    expect(rulesBroken(WORKFLOW.replace("    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    permissions: write-all\n"))).toContain("permissions");
  });

  it("would be caught reading another secret with bracket syntax", () => {
    expect(rulesBroken(withStepLine("          NPM: ${{ secrets['NPM_TOKEN'] }}"))).toContain("secrets");
  });

  it("would be caught using a third-party action", () => {
    const mutated = WORKFLOW.replace("      - name: Post to Discord\n", "      - uses: someone/action@main\n      - name: Post to Discord\n");
    expect(rulesBroken(mutated)).toContain("steps");
  });
});
