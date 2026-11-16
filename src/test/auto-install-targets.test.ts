import { describe, it, expect } from "vitest";
import { autoInstallTargets } from "../lib/agent-catalog";
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

describe("autoInstallTargets", () => {
  it("takes an npx agent whose only missing part is its own package", () => {
    expect(autoInstallTargets([npxAgent("qwen-code")])).toEqual(["qwen-code"]);
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
    expect(autoInstallTargets(agents)).toEqual([]);
  });

  it("leaves out an agent that is ready, and binary and uvx agents", () => {
    const agents = [
      npxAgent("ready", { availability: "ready", install_plan: null }),
      npxAgent("binary", { distribution: "binary" }),
      npxAgent("uvx", { distribution: "uvx" }),
      npxAgent("unknown", { distribution: null }),
    ];
    expect(autoInstallTargets(agents)).toEqual([]);
  });

  it("keeps the order it was given", () => {
    expect(autoInstallTargets([npxAgent("b"), npxAgent("ready", { availability: "ready" }), npxAgent("a")])).toEqual(["b", "a"]);
  });
});
