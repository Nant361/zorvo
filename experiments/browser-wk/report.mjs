const shared = [
  "cookies per session",
  "no cookie overwrite across sessions",
  "isolated content world",
  "no app bridge in page world",
  "hidden tab works",
];
const modes = {
  public: {
    scope: "Public-delegate permission, isolation and scroll checks",
    required: [
      ...shared,
      "camera denied", "microphone denied", "geolocation denied",
      "screen capture denial", "native scroll smoke check", "scroll performance",
    ],
  },
  restricted: {
    scope: "Restricted-view permission and isolation checks",
    required: [
      ...shared,
      "restricted capture in top document and subframe",
      "location denied in document", "location denied in frame",
      "restricted capture in cross-origin frame", "location denied in cross-origin frame",
    ],
  },
};
modes["screen-spi"] = { ...modes.public, scope: "Diagnostic screen-SPI permission, isolation and scroll checks" };

export function assessReport(report, mode) {
  if (!Object.hasOwn(modes, mode)) throw new Error("Invalid probe mode.");
  const { scope, required } = modes[mode];
  if (!report || typeof report.os !== "string" || !Array.isArray(report.results)) {
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
  return { scope, status };
}
