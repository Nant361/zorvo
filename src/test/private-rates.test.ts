import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREDITS_PER_USD_COST,
  privateErrorText,
  TURN_INPUT_TOKENS,
  TURN_OUTPUT_TOKENS,
} from "../lib/private-credits";

/**
 * The Credits Worker sets the rates; the app only estimates with copies of them. These checks read
 * the three places a rate lives (the Worker's variables, the Rust constants, the frontend's) and
 * fail when one changes without the others.
 */
function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function workerVar(name: string): number {
  const match = new RegExp(`"${name}"\\s*:\\s*"([0-9]+)"`).exec(read("server/wrangler.jsonc"));
  if (!match) throw new Error(`server/wrangler.jsonc has no ${name}`);
  return Number(match[1]);
}

function rustConst(name: string): number {
  const match = new RegExp(`const ${name}: (?:u64|f64) = ([0-9_.]+);`).exec(
    read("src-tauri/src/private_mode/mod.rs"),
  );
  if (!match) throw new Error(`private_mode/mod.rs has no ${name}`);
  return Number(match[1].replaceAll("_", ""));
}

describe("Zorvo Private's rates", () => {
  it("burn the same credits per dollar of cost in the Worker, the backend and the frontend", () => {
    const worker = workerVar("BURN_PER_USD_COST");

    expect(rustConst("CREDITS_PER_USD_COST")).toBe(worker);
    expect(CREDITS_PER_USD_COST).toBe(worker);
  });

  it("buy the same credits per dollar paid in the Worker and the backend", () => {
    expect(rustConst("CREDITS_PER_USD_PAID")).toBe(workerVar("CREDITS_PER_USD_PAID"));
  });

  it("size a turn the same way in the backend and the frontend", () => {
    expect(rustConst("TURN_INPUT_TOKENS")).toBe(TURN_INPUT_TOKENS);
    expect(rustConst("TURN_OUTPUT_TOKENS")).toBe(TURN_OUTPUT_TOKENS);
  });

  it("name the Worker's device limit in the error for going over it", () => {
    const limit = workerVar("DEVICE_CAP_CREDITS").toLocaleString("en-US");

    expect(privateErrorText("device_cap")).toContain(`${limit}-credit limit`);
  });
});
