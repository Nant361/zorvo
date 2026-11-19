import { describe, expect, it } from "vitest";
import { createdFilesOf, fileNameAndFolder, pathInFolder } from "../lib/created-files";
import type { ChatMessage, ToolExecution } from "../types";

function tool(id: string, status: ToolExecution["status"], path: string, isNewFile: boolean, startedAt: number): ToolExecution {
  return { id, name: "Write", title: `Write ${path}`, status, startedAt, details: [{ kind: "diff", path, isNewFile, rows: [] }] } as ToolExecution;
}

const reply = (id: string, tools: ToolExecution[]): ChatMessage => ({ id, role: "agent", content: "", timestamp: 1, tools });

describe("createdFilesOf", () => {
  it("lists new files from completed tools only, one row per path, the newest first", () => {
    const messages = [
      reply("a", [tool("t1", "completed", "/w/src/a.ts", true, 10), tool("t2", "completed", "/w/src/old.ts", false, 11)]),
      reply("b", [tool("t3", "failed", "/w/src/refused.ts", true, 12), tool("t4", "running", "/w/src/pending.ts", true, 13)]),
      reply("c", [tool("t5", "completed", "/w/src/b.ts", true, 20), tool("t6", "completed", "/w/src/a.ts", true, 30)]),
    ];

    expect(createdFilesOf(messages)).toEqual([
      { path: "/w/src/a.ts", at: 30 },
      { path: "/w/src/b.ts", at: 20 },
    ]);
  });

  it("counts a file named relative by one tool and absolute by another once", () => {
    const messages = [
      reply("a", [tool("t1", "completed", "src/a.ts", true, 10)]),
      reply("b", [tool("t2", "completed", "/w/zorvo/src/a.ts", true, 20)]),
    ];
    expect(createdFilesOf(messages, "/w/zorvo")).toEqual([{ path: "/w/zorvo/src/a.ts", at: 20 }]);
  });

  it("lists a new file whose diff was too large to keep", () => {
    const big = { ...tool("t1", "completed", "/w/big.json", true, 10), details: [{ kind: "changed" as const, path: "/w/big.json", isNewFile: true }] };
    const edited = { ...tool("t2", "completed", "/w/old.json", false, 11), details: [{ kind: "changed" as const, path: "/w/old.json" }] };
    expect(createdFilesOf([reply("a", [big, edited])])).toEqual([{ path: "/w/big.json", at: 10 }]);
  });

  it("keeps no time for a file from an imported session's replayed history, and puts it last", () => {
    const replayed = { ...reply("old", [tool("t1", "completed", "/w/replayed.ts", true, 99)]), hasKnownTime: false };
    const live = reply("new", [tool("t2", "completed", "/w/live.ts", true, 50)]);
    expect(createdFilesOf([replayed, live])).toEqual([
      { path: "/w/live.ts", at: 50 },
      { path: "/w/replayed.ts", at: null },
    ]);
  });

  it("reads a reply once and again only when it changes", () => {
    const first = reply("a", [tool("t1", "running", "/w/a.ts", true, 10)]);
    expect(createdFilesOf([first])).toEqual([]);
    const done = { ...first, tools: [tool("t1", "completed", "/w/a.ts", true, 10)] };
    expect(createdFilesOf([done])).toEqual([{ path: "/w/a.ts", at: 10 }]);
  });
});

describe("paths of created files", () => {
  it("takes the folder off an absolute path inside it, keeps a relative one, and refuses the rest", () => {
    expect(pathInFolder("/w/zorvo/src/a.ts", "/w/zorvo")).toBe("src/a.ts");
    expect(pathInFolder("/w/zorvo/src/a.ts", "/w/zorvo/")).toBe("src/a.ts");
    expect(pathInFolder("./src/a.ts", "/w/zorvo")).toBe("src/a.ts");
    expect(pathInFolder("/w/zorvo-other/a.ts", "/w/zorvo")).toBeNull();
    expect(pathInFolder("../secret", "/w/zorvo")).toBeNull();
    expect(pathInFolder("/w/zorvo/../etc/hosts", "/w/zorvo")).toBeNull();
  });

  it("names the file and the folder it sits in", () => {
    expect(fileNameAndFolder("/w/zorvo/src/lib/pr-chip.ts", "/w/zorvo")).toEqual({ name: "pr-chip.ts", where: "src/lib" });
    expect(fileNameAndFolder("/w/zorvo/README.md", "/w/zorvo")).toEqual({ name: "README.md", where: "" });
  });
});
