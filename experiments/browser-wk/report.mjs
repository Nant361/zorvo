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

export function requiredChecks(mode) {
  if (!Object.hasOwn(modes, mode)) throw new Error("Invalid probe mode.");
  return [...modes[mode].required];
}

export function assessReport(report, mode) {
  const required = requiredChecks(mode);
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
  const status = report.results.some(row => row.status === "fail") ? "fail"
    : report.results.some(row => row.status === "unverified") ? "unverified" : "pass";
  return { scope: modes[mode].scope, status };
}
