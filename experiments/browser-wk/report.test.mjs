import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { assessReport } from "./report.mjs";

const shared = [
  "cookies per session", "no cookie overwrite across sessions", "isolated content world",
  "no app bridge in page world", "React controlled input", "screen capture preference disabled", "bundle usage declarations",
  "screen recording grant precondition",
  ...["document", "same-origin frame", "cross-origin frame"].flatMap(frame => [
    "capture APIs in " + frame, "camera denied in " + frame,
    "microphone denied in " + frame, "location denied in " + frame,
  ]),
];
const zorvo = [...shared, "hidden lifecycle measurements", "hidden React interaction"];
const report = (gates, mode = "zorvo") => ({
  os: "fixture OS", mode,
  results: gates.map(gate => ({ gate, status: "pass", evidence: "fixture" })),
});

test("a complete report assesses only the named standalone observations", () => {
  assert.deepEqual(assessReport(report(zorvo), "zorvo"), {
    scope: "Standalone Zorvo-configuration observations for engine spikes 1, 2, 3 and 7",
    status: "pass",
  });
});

test("usage-declaration variants validate all frame checks", () => {
  assert.equal(assessReport(report([...shared, "native media delegate denied"], "usage-strings"), "usage-strings").status, "pass");
  for (const mode of ["camera-only", "microphone-only"]) {
    const observations = shared.filter(gate => !/^(camera|microphone) denied in /.test(gate));
    assert.equal(assessReport(report(observations, mode), mode).status, "pass");
  }
});

test("a hidden React failure cannot pass because the other observations passed", () => {
  const input = report(zorvo);
  input.results.find(row => row.gate === "hidden React interaction").status = "fail";
  assert.equal(assessReport(input, "zorvo").status, "fail");
});

test("an empty or partial report cannot pass", () => {
  for (const results of [[], report(zorvo).results.slice(1)]) {
    assert.throws(() => assessReport({ os: "fixture OS", mode: "zorvo", results }, "zorvo"), /missing/i);
  }
});

test("removing a cross-origin permission result fails validation", () => {
  const input = report(zorvo);
  input.results = input.results.filter(row => row.gate !== "location denied in cross-origin frame");
  assert.throws(() => assessReport(input, "zorvo"), /missing/i);
});

test("reports from another mode cannot satisfy the required checks", () => {
  assert.throws(() => assessReport(report(shared), "zorvo"), /missing/i);
  assert.throws(() => assessReport(report(shared, "camera-only"), "microphone-only"), /invalid/i);
  assert.throws(() => assessReport(report(zorvo), "usage-strings"), /invalid/i);
  assert.throws(() => assessReport(report(zorvo), "restricted"), /mode/i);
  assert.throws(() => assessReport(report(zorvo), "screen-spi"), /mode/i);
});

test("duplicate and malformed check results fail validation", () => {
  for (const extra of [
    report(zorvo).results[0], { gate: "extra", status: "PASS" }, { gate: "extra", status: "pass" },
    { gate: "extra", status: "pass", evidence: "fixture" },
    { gate: "harness", status: "pass", evidence: "fixture" },
    { gate: 5, status: "pass", evidence: "fixture" }, null,
  ]) {
    const input = report(zorvo);
    input.results.push(extra);
    assert.throws(() => assessReport(input, "zorvo"), /invalid|duplicate/i);
  }
});

test("a late harness failure overrides preceding passing checks", () => {
  const input = report(zorvo);
  input.results.push({ gate: "harness", status: "fail", evidence: "navigation failed" });
  assert.equal(assessReport(input, "zorvo").status, "fail");
});

test("unverified runtime evidence stays unverified", () => {
  const input = report(zorvo);
  input.results.find(row => row.gate === "hidden React interaction").status = "unverified";
  assert.equal(assessReport(input, "zorvo").status, "unverified");
});

test("malformed report containers fail before an assessment is returned", () => {
  for (const input of [null, {}, { results: [] }, { os: "fixture OS", results: {} }]) {
    assert.throws(() => assessReport(input, "zorvo"), /invalid/i);
  }
});

test("current recorded reports validate and name the exact committed probe sources", async () => {
  const sources = ["Probe.swift", "HiddenProbe.swift", "Fixture.tsx", "fixture.mjs", "Info.plist", "run.mjs", "report.mjs"];
  for (const [name, mode] of [["public", "zorvo"], ["usage-strings", "usage-strings"],
    ["camera-only", "camera-only"], ["microphone-only", "microphone-only"]]) {
    const recorded = JSON.parse(await readFile(new URL(`./results/2026-11-20-${name}.json`, import.meta.url), "utf8"));
    assert.deepEqual(recorded.assessment, assessReport(recorded, mode));
    for (const source of sources) {
      const digest = createHash("sha256").update(await readFile(new URL(source, import.meta.url))).digest("hex");
      assert.equal(recorded.harness.sources[source], digest, name + " uses stale " + source);
    }
    assert.match(recorded.harness.sources["fixture.bundle.js"], /^[a-f0-9]{64}$/);
  }
});

test("recorded hidden, covered and minimized native captures match the measured PNGs", async () => {
  const recorded = JSON.parse(await readFile(new URL("./results/2026-11-20-public.json", import.meta.url), "utf8"));
  const measurements = recorded.results.find(row => row.gate === "hidden lifecycle measurements").evidence;
  for (const mode of ["hidden", "covered", "minimized"]) {
    const measurement = measurements.find(row => row.mode === mode);
    assert.equal(measurement.reactAndSnapshotWithinOneSecond, true);
    assert.equal(measurement.snapshotState, measurement.expectedState);
    assert.notEqual(measurement.beforeImage.sha256, measurement.afterImage.sha256);
    if (mode === "minimized") assert.equal(measurement.windowMiniaturized, true);
    if (mode === "covered") assert.equal(measurement.windowVisible, false);
    assert.equal(measurement.documentHidden, true);
    for (const image of [measurement.beforeImage, measurement.afterImage]) {
      const png = await readFile(new URL("./results/2026-11-20-background/" + image.file, import.meta.url));
      assert.equal(createHash("sha256").update(png).digest("hex"), image.sha256);
    }
  }
});
