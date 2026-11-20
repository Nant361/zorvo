import assert from "node:assert/strict";
import { test } from "node:test";
import { assessReport } from "./report.mjs";

const shared = [
  "cookies per session",
  "no cookie overwrite across sessions",
  "isolated content world",
  "no app bridge in page world",
  "hidden tab works",
];
const restricted = [
  ...shared,
  "restricted capture in top document and subframe",
  "location denied in document",
  "location denied in frame",
  "restricted capture in cross-origin frame",
  "location denied in cross-origin frame",
];
const normal = [
  ...shared,
  "camera denied",
  "microphone denied",
  "geolocation denied",
  "screen capture denial",
  "native scroll smoke check",
  "scroll performance",
];
const report = gates => ({
  os: "fixture OS",
  results: gates.map(gate => ({ gate, status: "pass", evidence: "fixture" })),
});

test("a complete restricted report passes only its permission and isolation scope", () => {
  assert.deepEqual(assessReport(report(restricted), "restricted"), {
    scope: "Restricted-view permission and isolation checks",
    status: "pass",
  });
});

test("a default report retains failed capture and unverified performance", () => {
  const input = report(normal);
  input.results.find(row => row.gate === "screen capture denial").status = "fail";
  input.results.find(row => row.gate === "scroll performance").status = "unverified";
  assert.equal(assessReport(input, "public").status, "fail");
});

test("a diagnostic screen denial does not complete an unverified performance check", () => {
  const input = report(normal);
  input.results.find(row => row.gate === "scroll performance").status = "unverified";
  assert.equal(assessReport(input, "screen-spi").status, "unverified");
});

test("an empty or partial report cannot pass", () => {
  for (const results of [[], report(restricted).results.slice(1)]) {
    assert.throws(() => assessReport({ os: "fixture OS", results }, "restricted"), /missing/i);
  }
});

test("reports from another mode cannot satisfy the required checks", () => {
  assert.throws(() => assessReport(report(normal), "restricted"), /invalid|missing/i);
  assert.throws(() => assessReport(report(restricted), "public"), /invalid|missing/i);
  assert.throws(() => assessReport(report(restricted), "unknown"), /mode/i);
});

test("duplicate and malformed check results fail validation", () => {
  for (const extra of [
    report(restricted).results[0],
    { gate: "extra", status: "PASS" },
    { gate: "extra", status: "pass" },
    { gate: "extra", status: "pass", evidence: "fixture" },
    { gate: "harness", status: "pass", evidence: "fixture" },
    { gate: 5, status: "pass", evidence: "fixture" },
    null,
  ]) {
    const input = report(restricted);
    input.results.push(extra);
    assert.throws(() => assessReport(input, "restricted"), /invalid|duplicate/i);
  }
});

test("a late harness failure overrides preceding passing checks", () => {
  const input = report(restricted);
  input.results.push({ gate: "harness", status: "fail", evidence: "navigation failed" });
  assert.equal(assessReport(input, "restricted").status, "fail");
});

test("older runtime location checks remain unverified without a request", () => {
  const input = report(restricted);
  for (const result of input.results) {
    if (result.gate.startsWith("location denied")) result.status = "unverified";
  }
  assert.equal(assessReport(input, "restricted").status, "unverified");
});

test("malformed report containers fail before an assessment is returned", () => {
  for (const input of [null, {}, { results: [] }, { os: "fixture OS", results: {} }]) {
    assert.throws(() => assessReport(input, "restricted"), /invalid/i);
  }
});
