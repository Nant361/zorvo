const shared = [
  "cookies per session", "no cookie overwrite across sessions", "isolated content world",
  "no app bridge in page world", "React controlled input", "screen capture preference disabled", "bundle usage declarations",
  "screen recording grant precondition",
  ...["document", "same-origin frame", "cross-origin frame"].flatMap(frame => [
    "capture APIs in " + frame, "camera denied in " + frame,
    "microphone denied in " + frame, "location denied in " + frame,
  ]),
];
const singleDeclaration = shared.filter(gate => !/^(camera|microphone) denied in /.test(gate));
const modes = {
  zorvo: {
    scope: "Standalone Zorvo-configuration observations for engine spikes 1, 2, 3 and 7",
    required: [...shared, "hidden lifecycle measurements", "hidden React interaction"],
  },
  "usage-strings": {
    scope: "Capture hardening with camera and microphone usage declarations",
    required: [...shared, "native media delegate denied"],
  },
  "camera-only": { scope: "API surface and location with only the camera declaration; media requests not attempted", required: singleDeclaration },
  "microphone-only": { scope: "API surface and location with only the microphone declaration; media requests not attempted", required: singleDeclaration },
};

export function requiredChecks(mode, version = 1, longHidden = false) {
  if (!Object.hasOwn(modes, mode)) throw new Error("Invalid probe mode.");
  if (![1, 2, 3, 4].includes(version)) throw new Error("Unsupported report schema.");
  const required = [...modes[mode].required];
  if (version >= 2 && mode === "zorvo") {
    required.push("visible-window fallback interaction");
    if (longHidden) required.push("long hidden React interaction");
  }
  return required;
}

export function hiddenInteractionPass(measurements, delayed = false, accurateSpan = true) {
  const names = delayed ? ["hidden-after-idle", "minimized-after-idle"] : ["hidden", "covered", "minimized"];
  if (!Array.isArray(measurements)) return false;
  return names.every(name => {
    const matches = measurements.filter(row => row?.mode === name);
    if (matches.length !== 1) return false;
    const row = matches[0];
    return row.documentHidden === true && row.reactAndSnapshotWithinOneSecond === true &&
      row.snapshotState === row.expectedState && row.stateLatencyMs <= 1000 && row.visualLatencyMs <= 1000 &&
      row.beforeImage?.sha256 !== undefined && row.afterImage?.sha256 !== undefined &&
      row.beforeImage.sha256 !== row.afterImage.sha256 &&
      (!name.startsWith("minimized") || row.windowMiniaturized === true) &&
      (name !== "covered" || row.windowVisible === false) &&
      (!delayed || (row.quietDurationMs >= 180000 &&
        (accurateSpan ? row.lastFiveSecondsOfQuiet?.windowMs >= 5000 && row.lastFiveSecondsOfQuiet.windowMs <= 6500 &&
        row.lastFiveSecondsOfQuiet.oldestSampleAgeMs >= 5000 && row.lastFiveSecondsOfQuiet.oldestSampleAgeMs <= 6500 : row.lastFiveSecondsOfQuiet?.windowMs >= 4990)));
  });
}

export function locationDenialPass(evidence) {
  return evidence?.result === "1" && typeof evidence.publicDelegateAvailable === "boolean" &&
    evidence.callbacks === (evidence.publicDelegateAvailable ? 1 : 0);
}

export function assessReport(report, mode) {
  const version = report?.schemaVersion ?? 1;
  const required = requiredChecks(mode, version, report?.longHidden === true);
  if (!report || report.mode !== mode || typeof report.os !== "string" || !Array.isArray(report.results)) {
    throw new Error("Invalid probe report.");
  }
  const seen = new Set();
  for (const row of report.results) {
    if (!row || typeof row.gate !== "string" || !Object.hasOwn(row, "evidence") ||
      !["pass", "fail", "unverified"].includes(row.status) ||
      (!required.includes(row.gate) && row.gate !== "harness") ||
      (row.gate === "harness" && row.status !== "fail")) {
      throw new Error("Invalid probe check result.");
    }
    if (seen.has(row.gate)) throw new Error("Duplicate probe check result.");
    seen.add(row.gate);
  }
  const missing = required.filter(gate => !seen.has(gate));
  if (missing.length) throw new Error("Missing probe checks. " + missing.join(", "));
  if (version >= 2) {
    if (typeof report.longHidden !== "boolean") throw new Error("Missing hidden-run scope.");
    for (const row of report.results) {
      if (version >= 4 && row.gate.startsWith("capture APIs in ") && row.status === "unverified") {
        if (report.launchContext?.launch !== "direct" || row.evidence?.mediaDevices !== "undefined" ||
          row.evidence?.screen !== "undefined" || !row.evidence?.inheritedAuthorization) {
          throw new Error("Unverified capture surface must name the unexercised inherited authorization.");
        }
      }
      if (version >= 3 && row.status === "pass" && row.gate.startsWith("capture APIs in ")) {
        const evidence = row.evidence;
        const direct = report.launchContext?.launch === "direct";
        const expected = mode === "usage-strings" || (mode === "zorvo" && direct) ? "present" : mode === "zorvo" ? "absent" : "observed";
        if (evidence?.expectedMediaDevices !== expected || evidence.screen !== "undefined" ||
          (expected === "present" && (evidence.mediaDevices !== "object" || evidence.cameraOrMicrophone !== "function")) ||
          (expected === "absent" && evidence.mediaDevices !== "undefined")) {
          throw new Error("Capture surface pass contradicts the launch expectation.");
        }
      }
      if (row.status === "pass" && row.gate.startsWith("location denied in ") && !locationDenialPass(row.evidence)) {
        throw new Error("Location pass contradicts the recorded delegate callbacks.");
      }
    }
    if (mode === "zorvo") {
      const measurements = report.results.find(row => row.gate === "hidden lifecycle measurements")?.evidence;
      for (const [gate, delayed] of [["hidden React interaction", false], ["long hidden React interaction", true]]) {
        const row = report.results.find(row => row.gate === gate);
        if (row?.status === "pass" && !hiddenInteractionPass(measurements, delayed, version >= 4)) {
          throw new Error("Hidden interaction pass contradicts the recorded conditions.");
        }
      }
      const fallback = report.results.find(row => row.gate === "visible-window fallback interaction");
      if (fallback?.status === "pass" &&
        !measurements?.some(row => row.mode === "same-window-cover" && row.reactAndSnapshotWithinOneSecond === true)) {
        throw new Error("Fallback pass has no successful fallback observation.");
      }
    }
  }
  const status = report.results.some(row => row.status === "fail") ? "fail"
    : report.results.some(row => row.status === "unverified") ? "unverified" : "pass";
  return { scope: modes[mode].scope, status };
}
