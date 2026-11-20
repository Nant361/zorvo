import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frameSummary } from "./timing.mjs";

const [directory, ...names] = process.argv.slice(2);
const allowed = ["opencode", "wk", "restricted", "wk-split"];
if (!directory || names.length === 0 || names.some(name => !allowed.includes(name)) || new Set(names).size !== names.length) {
  throw new Error("Usage: node experiments/browser-wk/scroll/summarize.mjs <results directory> <host> [...hosts]");
}

const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
const runs = [];
for (const name of names) {
  const raw = await readFile(path.join(directory, name + ".json"));
  const samples = JSON.parse(raw);
  if (!Array.isArray(samples) || samples.length !== 4) throw new Error("Incomplete run for " + name);
  const expectedOrder = name === "wk" ? [true, false, false, true] : [false, true, true, false];
  const rounds = samples.map((sample, index) => {
    const timings = sample.framesMs;
    if (sample.round !== index + 1 || sample.stream !== expectedOrder[index] || sample.hidden !== false ||
      !Number.isFinite(sample.elapsedMs) || sample.elapsedMs < 20_000 || sample.elapsedMs > 21_000 ||
      !Number.isFinite(sample.distance) || Math.abs(sample.distance - sample.elapsedMs * 1.2) > 2 ||
      !Array.isArray(timings) || timings.length < 100 ||
      timings.some(interval => !Number.isFinite(interval) || interval <= 0) ||
      Math.abs(timings.reduce((sum, interval) => sum + interval, 0) - sample.elapsedMs) > 1 ||
      sample.chatView !== (name === "wk-split" ? "separate" : "same") ||
      !Array.isArray(sample.viewport) || sample.viewport.length !== 2 ||
      sample.viewport[0] < 220 || sample.viewport[0] > 240 || sample.viewport[1] !== 340 ||
      !Number.isInteger(sample.chunks) ||
      sample.renderedText !== sample.stream ||
      (sample.stream ? sample.chunks < 350 || sample.chunks > 410 : sample.chunks !== 0)) {
      throw new Error("Invalid or interrupted measurements for " + name + ", round " + (index + 1));
    }
    const sorted = [...timings].sort((left, right) => left - right);
    const counts = new Map();
    for (const interval of sorted) counts.set(interval, (counts.get(interval) ?? 0) + 1);
    return {
      round: sample.round, stream: sample.stream, chunks: sample.chunks,
      chatView: sample.chatView, viewport: sample.viewport, elapsedMs: sample.elapsedMs,
      distance: sample.distance, frames: timings.length,
      ...frameSummary(timings),
      averageFramesPerSecond: 1000 * timings.length / sample.elapsedMs,
      intervalsOver33Ms: timings.filter(interval => interval > 33.34).length,
      intervalCountsMs: [...counts],
    };
  });
  if (rounds.filter(round => round.stream).length !== 2) throw new Error("Incomplete scenarios for " + name);
  runs.push({ host: name, rawSha256: createHash("sha256").update(raw).digest("hex"), rounds });
}
const report = {
  measurement: "Scripted requestAnimationFrame scroll with local React chat updates",
  interpretation: "Callback cadence reflects each host's scheduling rate. Long intervals are compared with 1.5 times that round's median; native scroll latency is unmeasured.",
  summarySources: Object.fromEntries(await Promise.all(["summarize.mjs", "timing.mjs"].map(async name => [
    name, createHash("sha256").update(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), name))).digest("hex"),
  ]))),
  manifest,
  runs,
};
await writeFile(path.join(directory, "summary.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
