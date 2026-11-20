import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { frameSummary } from "./timing.mjs";

test("regular 60 Hz and 120 Hz callbacks have identical relative long-frame counts", () => {
  for (const interval of [1000 / 60, 1000 / 120]) {
    const report = frameSummary(Array(200).fill(interval));
    assert.equal(report.intervalsOver1_5Median, 0);
    assert.equal(report.longIntervalPercent, 0);
    assert.equal(report.medianMs, interval);
  }
});

test("one delayed callback is counted relative to each host's own median", () => {
  for (const interval of [1000 / 60, 1000 / 120]) {
    const report = frameSummary([...Array(99).fill(interval), 2 * interval]);
    assert.equal(report.intervalsOver1_5Median, 1);
    assert.equal(report.longIntervalPercent, 1);
    assert.equal(report.longIntervalThresholdMs, 1.5 * interval);
  }
});

test("the threshold is strict and an even sample uses the two central values", () => {
  const intervals = [10, 10, 15, 20];
  const report = frameSummary(intervals);
  assert.equal(report.medianMs, 12.5);
  assert.equal(report.intervalsOver1_5Median, 1);
  assert.equal(report.p95Ms, 20);
  assert.deepEqual(intervals, [10, 10, 15, 20]);
  assert.equal(frameSummary([10, 10, 10, 15]).intervalsOver1_5Median, 0);
});

test("missing or invalid samples cannot produce a frame summary", () => {
  for (const intervals of [[], [0], [-1], [NaN], [Infinity], null]) {
    assert.throws(() => frameSummary(intervals));
  }
});

test("recorded renderer rounds agree with their histograms and the current summary scripts", async () => {
  const report = JSON.parse(await readFile(new URL("../results/2026-11-20-scroll.json", import.meta.url), "utf8"));
  for (const source of ["summarize.mjs", "timing.mjs"]) {
    const digest = createHash("sha256").update(await readFile(new URL(source, import.meta.url))).digest("hex");
    assert.equal(report.summarySources[source], digest);
  }
  assert.equal(report.runs.length, 3);
  for (const run of report.runs) {
    assert.equal(run.rounds.length, 4);
    for (const round of run.rounds) {
      const intervals = round.intervalCountsMs.flatMap(([interval, count]) => Array(count).fill(interval));
      assert.equal(intervals.length, round.frames);
      const summary = frameSummary(intervals);
      for (const key of Object.keys(summary)) assert.equal(round[key], summary[key], run.host + " " + key);
    }
  }
});
