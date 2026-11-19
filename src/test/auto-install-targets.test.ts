import { describe, it, expect } from "vitest";
import { autoInstallTargets, usedAgentIds } from "../lib/agent-catalog";
import { makeProfile } from "./fixtures/agents";
import type { AgentProfile, InstallStep } from "../types";

const step = (kind: InstallStep["kind"]): InstallStep => ({ kind, name: kind, version: "1.0.0", download_bytes: null });

function npxAgent(id: string, overrides: Partial<AgentProfile> = {}): AgentProfile {
  return makeProfile({
    id,
    name: id,
    distribution: "npx",
    availability: "not_installed",
    install_plan: [step("agent")],
    ...overrides,
  });
}

/** Every agent counts as used, for the tests about the other rules. */
const all = (agents: readonly AgentProfile[]) => autoInstallTargets(agents, usedAgentIds({ defaultAgentId: null }, agents.map((agent) => ({ profileId: agent.id }))));

describe("autoInstallTargets", () => {
  it("takes an npx agent whose only missing part is its own package", () => {
    expect(all([npxAgent("qwen-code")])).toEqual(["qwen-code"]);
  });

  it("leaves out an agent that also needs a runtime or a prerequisite", () => {
    const agents = [
      npxAgent("needs-node", { availability: "needs_runtime", install_plan: [step("node"), step("agent")] }),
      npxAgent("node-first", { install_plan: [step("node"), step("agent")] }),
      npxAgent("needs-pi", { install_plan: [step("prerequisite"), step("agent")] }),
      npxAgent("only-pi", { install_plan: [step("prerequisite")] }),
      npxAgent("no-plan", { install_plan: null }),
      npxAgent("empty-plan", { install_plan: [] }),
    ];
    expect(all(agents)).toEqual([]);
  });

  it("leaves out an agent that is ready, and binary and uvx agents", () => {
    const agents = [
      npxAgent("ready", { availability: "ready", install_plan: null }),
      npxAgent("binary", { distribution: "binary" }),
      npxAgent("uvx", { distribution: "uvx" }),
      npxAgent("unknown", { distribution: null }),
    ];
    expect(all(agents)).toEqual([]);
  });

  it("keeps the order it was given", () => {
    expect(all([npxAgent("b"), npxAgent("ready", { availability: "ready" }), npxAgent("a")])).toEqual(["b", "a"]);
  });

  it("leaves out an agent in use that you have never used", () => {
    const agents = [npxAgent("claude-acp"), npxAgent("codex-acp"), npxAgent("qwen-code"), npxAgent("gemini")];
    const used = usedAgentIds({ defaultAgentId: "codex-acp", signedInAgents: ["qwen-code"] }, [{ profileId: "claude-acp" }]);

    expect(autoInstallTargets(agents, used)).toEqual(["claude-acp", "codex-acp", "qwen-code"]);
    expect(autoInstallTargets(agents, usedAgentIds({ defaultAgentId: null }, []))).toEqual([]);
  });
});
