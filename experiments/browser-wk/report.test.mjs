import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { assessReport, hiddenInteractionPass, locationDenialPass, requiredChecks } from "./report.mjs";

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

test("recorded reports validate and identify the source commit without pinning the checkout", async () => {
  const sources = ["Probe.swift", "HiddenProbe.swift", "Fixture.tsx", "fixture.mjs", "Info.plist", "run.mjs", "report.mjs"];
  const names = (await readdir(new URL("./results/", import.meta.url))).filter(name => name.endsWith(".json") && !name.includes("scroll"));
  assert.ok(names.length >= 4);
  for (const name of names) {
    const recorded = JSON.parse(await readFile(new URL("./results/" + name, import.meta.url), "utf8"));
    assert.deepEqual(recorded.assessment, assessReport(recorded, recorded.mode));
    assert.match(recorded.harness.sourceCommit, /^[a-f0-9]{40}$/);
    for (const source of sources) {
      assert.match(recorded.harness.sources[source], /^[a-f0-9]{64}$/);
    }
    assert.match(recorded.harness.sources["fixture.bundle.js"], /^[a-f0-9]{64}$/);
    assert.match(recorded.harness.binarySha256, /^[a-f0-9]{64}$/);
    assert.match(recorded.harness.buildManifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(recorded.bundleIdentifier, recorded.harness.identifier);
    assert.equal(typeof recorded.harness.reusedBinary, "boolean");
    assert.equal(typeof recorded.registeredApplication.resolved, "boolean");
    if (recorded.registeredApplication.resolved) {
      assert.equal(recorded.registeredApplication.snapshotRelativePath.split("/").length, 2);
    } else assert.equal(recorded.registeredApplication.snapshotRelativePath, "unresolved");
    assert.ok(!JSON.stringify(recorded).includes("/Users/"), "Recorded evidence must not disclose a home path.");
  }
});

function hiddenRows() {
  return ["hidden", "covered", "minimized", "same-window-cover"].map(mode => ({
    mode, documentHidden: mode !== "same-window-cover", windowMiniaturized: mode === "minimized",
    windowVisible: mode !== "covered", reactAndSnapshotWithinOneSecond: true,
    expectedState: "1", snapshotState: "1", stateLatencyMs: 10, visualLatencyMs: 20,
    beforeImage: { sha256: "a".repeat(64) }, afterImage: { sha256: "b".repeat(64) },
  }));
}

function currentReport() {
  const value = report(requiredChecks("zorvo", 2));
  value.schemaVersion = 2;
  value.longHidden = false;
  value.results.find(row => row.gate === "hidden lifecycle measurements").evidence = hiddenRows();
  for (const row of value.results.filter(row => row.gate.startsWith("location denied in "))) {
    row.evidence = { result: "1", callbacks: 1, publicDelegateAvailable: true };
  }
  return value;
}

test("a visible fallback cannot turn a failed hidden or minimized gate into a pass", () => {
  const input = currentReport();
  assert.equal(assessReport(input, "zorvo").status, "pass");
  const rows = input.results.find(row => row.gate === "hidden lifecycle measurements").evidence;
  rows.find(row => row.mode === "minimized").reactAndSnapshotWithinOneSecond = false;
  assert.throws(() => assessReport(input, "zorvo"), /Hidden interaction pass/);
  input.results.find(row => row.gate === "hidden React interaction").status = "fail";
  assert.equal(assessReport(input, "zorvo").status, "fail");
  assert.equal(input.results.find(row => row.gate === "visible-window fallback interaction").status, "pass");
});

test("all three actual hidden conditions are required independently of the fallback", () => {
  for (const mode of ["hidden", "covered", "minimized"]) {
    const rows = hiddenRows();
    assert.equal(hiddenInteractionPass(rows), true);
    rows.find(row => row.mode === mode).documentHidden = false;
    assert.equal(hiddenInteractionPass(rows), false);
    assert.equal(hiddenInteractionPass(hiddenRows().filter(row => row.mode !== mode)), false);
  }
});

test("long hidden evidence requires both three-minute quiet windows", () => {
  const rows = hiddenRows().filter(row => ["hidden", "minimized"].includes(row.mode)).map(row => ({
    ...row, mode: row.mode + "-after-idle", quietDurationMs: 180010,
    lastFiveSecondsOfQuiet: { windowMs: 5000 },
  }));
  assert.equal(hiddenInteractionPass(rows, true), true);
  rows[1].quietDurationMs = 5000;
  assert.equal(hiddenInteractionPass(rows, true), false);
});

test("location denial needs exactly one public callback on 27 and zero below it", () => {
  for (const available of [false, true]) {
    assert.equal(locationDenialPass({ result: "1", publicDelegateAvailable: available, callbacks: available ? 1 : 0 }), true);
    for (const callbacks of [0, 1, 2].filter(count => count !== (available ? 1 : 0))) {
      assert.equal(locationDenialPass({ result: "1", publicDelegateAvailable: available, callbacks }), false);
    }
  }
  const input = currentReport();
  input.results.find(row => row.gate === "location denied in cross-origin frame").evidence.callbacks = 0;
  assert.throws(() => assessReport(input, "zorvo"), /Location pass/);
});

test("the direct capture run must expose the inherited API instead of passing an unexercised denial", () => {
  const input = currentReport();
  input.schemaVersion = 3;
  input.launchContext = { launch: "direct" };
  const surfaces = input.results.filter(row => row.gate.startsWith("capture APIs in "));
  for (const row of surfaces) row.evidence = {
    expectedMediaDevices: "present", mediaDevices: "object", cameraOrMicrophone: "function", screen: "undefined",
  };
  assert.equal(assessReport(input, "zorvo").status, "pass");
  surfaces[1].evidence.mediaDevices = "undefined";
  assert.throws(() => assessReport(input, "zorvo"), /Capture surface pass/);
});

test("only the ordinary experiment plist is guarded by the experiment suite", async () => {
  const plist = await readFile(new URL("./Info.plist", import.meta.url), "utf8");
  for (const key of ["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSLocationUsageDescription"]) {
    assert.ok(!plist.includes(`<key>${key}</key>`));
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
