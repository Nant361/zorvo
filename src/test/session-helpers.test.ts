import { describe, it, expect } from "vitest";
import { folderNameOf, groupSessionsByWorkspace, isCommandOnly, mostRecentSessionId, nextSessionName, isAutoName, titleFromPrompt, titleSourceFor } from "../lib/session-helpers";
import type { SessionNode } from "../lib/session-helpers";
import type { Session } from "../types";

function session(id: string, cwd: string, createdAt: number): Session {
  return { id, name: id, profileId: "claude-code", cwd, status: "terminated", createdAt };
}

describe("session helpers", () => {
  it("takes the last path segment as the folder name", () => {
    expect(folderNameOf("/Users/a/project/")).toBe("project");
    expect(folderNameOf("/Users/a/my app")).toBe("my app");
  });

  it("returns the most recent session id, or empty without sessions", () => {
    expect(mostRecentSessionId([session("a", "/x", 1), session("b", "/x", 5)])).toBe("b");
    expect(mostRecentSessionId([])).toBe("");
  });

  const fork = (id: string, cwd: string, createdAt: number, parent: string) => ({
    ...session(id, cwd, createdAt),
    forkedFrom: parent,
  });
  const delegated = (id: string, cwd: string, createdAt: number, source: string) => ({
    ...session(id, cwd, createdAt),
    delegatedFrom: { sessionId: source, task: "Do it", startedAt: createdAt },
  });
  const ids = (nodes: SessionNode[]): unknown[] =>
    nodes.map((n) => (n.children.length ? [n.session.id, ids(n.children)] : n.session.id));

  it("lists every workspace in its own order, even one without sessions", () => {
    const groups = groupSessionsByWorkspace(
      [{ name: "web", path: "/w/web" }, { name: "api", path: "/w/api" }],
      [session("old-api", "/w/api", 1), session("new-api", "/w/api", 5)],
    );

    expect(groups.map((g) => g.name)).toEqual(["web", "api"]);
    expect(groups[0].sessions).toEqual([]);
    expect(ids(groups[1].sessions)).toEqual(["new-api", "old-api"]);
  });

  it("adds folders that only sessions know, newest first, after the workspaces", () => {
    const groups = groupSessionsByWorkspace(
      [{ name: "web", path: "/w/web" }],
      [session("a", "/w/a", 1), session("b", "/w/b", 2)],
    );

    expect(groups.map((g) => g.path)).toEqual(["/w/web", "/w/b", "/w/a"]);
  });

  it("nests forks under the session they came from", () => {
    const groups = groupSessionsByWorkspace(
      [{ name: "api", path: "/w/api" }],
      [
        session("root", "/w/api", 1),
        fork("fork-a", "/w/api", 2, "root"),
        fork("fork-of-fork", "/w/api", 3, "fork-a"),
        fork("fork-b", "/w/api", 4, "root"),
        session("other", "/w/api", 5),
      ],
    );

    expect(ids(groups[0].sessions)).toEqual(["other", ["root", ["fork-b", ["fork-a", ["fork-of-fork"]]]]]);
  });

  it("shows a fork at the top level when its source is gone or in another folder", () => {
    const groups = groupSessionsByWorkspace(
      [{ name: "api", path: "/w/api" }],
      [fork("orphan", "/w/api", 2, "deleted"), session("elsewhere", "/w/web", 1), fork("moved", "/w/api", 3, "elsewhere")],
    );

    expect(ids(groups[0].sessions)).toEqual(["moved", "orphan"]);
  });

  it("a delegated session sits under its source", () => {
    const groups = groupSessionsByWorkspace(
      [{ name: "api", path: "/w/api" }],
      [session("a", "/w/api", 1), delegated("b", "/w/api", 2, "a")],
    );

    expect(ids(groups[0].sessions)).toEqual([["a", ["b"]]]);
  });

  it("a delegated session is a root when its source is not listed", () => {
    const groups = groupSessionsByWorkspace(
      [{ name: "api", path: "/w/api" }],
      [delegated("b", "/w/api", 2, "archived-a")],
    );

    expect(ids(groups[0].sessions)).toEqual(["b"]);
  });

  it("lists a session that runs in a worktree under the workspace it was made from", () => {
    const inWorktree: Session = {
      ...session("wt", "/data/worktrees/api/fix-login", 3),
      worktree: { repoPath: "/w/api", path: "/data/worktrees/api/fix-login", branch: "agent/fix-login" },
    };
    const groups = groupSessionsByWorkspace([{ name: "api", path: "/w/api" }], [session("plain", "/w/api", 1), inWorktree]);

    expect(groups.map((g) => g.path)).toEqual(["/w/api"]);
    expect(ids(groups[0].sessions)).toEqual(["wt", "plain"]);
  });

  it("still lists sessions whose fork links form a loop", () => {
    const groups = groupSessionsByWorkspace(
      [{ name: "api", path: "/w/api" }],
      [fork("a", "/w/api", 1, "b"), fork("b", "/w/api", 2, "a")],
    );

    expect(ids(groups[0].sessions)).toEqual([["b", ["a"]]]);
  });
});

describe("nextSessionName", () => {
  const named = (name: string) => ({ name }) as Session;

  it("numbers sessions after the highest existing number, so names never repeat after a delete", () => {
    expect(nextSessionName([])).toBe("Session #1");
    expect(nextSessionName([named("Session #1"), named("Session #3")])).toBe("Session #4");
    expect(nextSessionName([named("Fix login"), named("Session #2 (fork)")])).toBe("Session #3");
  });
});

describe("titleFromPrompt", () => {
  it("uses the first line of the prompt, tidied up", () => {
    expect(titleFromPrompt("  fix the   login bug\nand add a test")).toBe("fix the login bug");
  });

  it("cuts a long prompt at a word boundary, near 60 characters", () => {
    const title = titleFromPrompt("refactor the stream parser so that it handles partial escape sequences across chunks");

    expect(title).toBe("refactor the stream parser so that it handles partial escape…");
    expect(title.length).toBeLessThanOrEqual(61);
  });

  it("cuts between characters, never inside an emoji", () => {
    const title = titleFromPrompt("🙂".repeat(80));
    expect(title).toBe(`${"🙂".repeat(60)}…`);
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    const source = titleSourceFor(`${"a".repeat(499)}🙂 tail`, "short");
    expect(source).toBe(`${"a".repeat(499)}🙂`);
  });

  it("falls back when the prompt has no text", () => {
    expect(titleFromPrompt("   \n ")).toBe("New session");
    expect(titleFromPrompt("      ")).toBe("New session");
  });

  it("names a GitHub link by its owner and repository", () => {
    expect(titleFromPrompt("apakah plugin https://github.com/affaan-m/ECC sudah terpasang di Qwen Code?")).toBe(
      "apakah plugin affaan-m/ECC sudah terpasang di Qwen Code?",
    );
    expect(titleFromPrompt("review https://github.com/zakyirsyaad/zorvo/pull/250.")).toBe("review zakyirsyaad/zorvo.");
    expect(titleFromPrompt("clone github.com/a/b.git first")).toBe("clone a/b first");
    // Another host on github.com is a site, not a repository.
    expect(titleFromPrompt("call https://api.github.com/repos/a/b now")).toBe("call api.github.com now");
  });

  it("names any other link by its site", () => {
    expect(titleFromPrompt("cek https://docs.near.ai/cloud/verification lalu bandingkan dengan verify.rs")).toBe(
      "cek docs.near.ai lalu bandingkan dengan verify.rs",
    );
    expect(titleFromPrompt("why does http://www.example.com:8080/a?b=1 fail")).toBe("why does example.com fail");
    // The site, never the account a link signs in with.
    expect(titleFromPrompt("fetch https://deploy:s3cret@registry.example.com/v2")).toBe("fetch registry.example.com");
    // A markdown link already says what it is.
    expect(titleFromPrompt("read [the NEAR docs](https://docs.near.ai/cloud/verification) first")).toBe(
      "read the NEAR docs first",
    );
  });

  it("shortens a long path to its last two parts, quoted or not", () => {
    expect(
      titleFromPrompt('Read the file "/Users/mac/Library/Application Support/xyz.zorvo.desktop/state.json" and tell me why it is so big'),
    ).toBe("Read the file xyz.zorvo.desktop/state.json and tell me why…");
    expect(titleFromPrompt("fix ~/developer/zorvo/src/App.tsx, please")).toBe("fix src/App.tsx, please");
    expect(titleFromPrompt("why does `/Users/mac/developer/zorvo/src/App.tsx` crash")).toBe("why does src/App.tsx crash");
    expect(titleFromPrompt("see (/Users/mac/developer/zorvo/README.md) first")).toBe("see (zorvo/README.md) first");
    // An apostrophe in a later word never closes a quote that opened before a path.
    expect(titleFromPrompt("check '/a/b/c/d isn't there")).toBe("check '/a/b/c/d isn't there");
    // Two parts or fewer are already short.
    expect(titleFromPrompt("look at /etc/hosts")).toBe("look at /etc/hosts");
  });

  it("leaves what is not a web link or a Mac path as written", () => {
    expect(titleFromPrompt("write to mailto:team@example.com")).toBe("write to mailto:team@example.com");
    expect(titleFromPrompt("open C:\\Users\\mac\\project\\main.ts")).toBe("open C:\\Users\\mac\\project\\main.ts");
    expect(titleFromPrompt("use and/or here")).toBe("use and/or here");
  });
});

describe("isCommandOnly", () => {
  it("is true for a slash command, with or without arguments, and nothing else", () => {
    expect(isCommandOnly("/init")).toBe(true);
    expect(isCommandOnly("  /review src/App.tsx  ")).toBe(true);
    expect(isCommandOnly("/compact\n\nfocus on the tests")).toBe(false);
    expect(isCommandOnly("/Users/mac/x is broken")).toBe(false);
    expect(isCommandOnly("please run /init")).toBe(false);
    expect(isCommandOnly("")).toBe(false);
  });
});

describe("isAutoName", () => {
  it("tells numbered placeholder names from real titles", () => {
    expect(isAutoName("Session #12")).toBe(true);
    expect(isAutoName("fix the login bug")).toBe(false);
    expect(isAutoName("Session #2 (fork)")).toBe(false);
  });
});

