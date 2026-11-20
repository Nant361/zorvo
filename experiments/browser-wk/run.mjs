import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const options = { signal: controller.signal, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 };
const hash = content => createHash("sha256").update(content).digest("hex");
let fixture;

try {
  if (process.platform !== "darwin") throw new Error("This spike requires macOS and Xcode.");
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(argument => !["--screen-spi", "--restricted"].includes(argument))) {
    throw new Error("Usage: node experiments/browser-wk/run.mjs [--screen-spi | --restricted]");
  }
  const mode = flags[0]?.slice(2) ?? "public";
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "zorvo-browser-wk-"));
  const app = path.join(outputDirectory, "Zorvo Browser Spike.app");
  const bin = path.join(app, "Contents", "MacOS");
  await mkdir(bin, { recursive: true });

  const sources = {};
  for (const name of ["Probe.swift", "fixture.mjs", "Info.plist", "run.mjs", "report.mjs"]) {
    const content = await readFile(path.join(directory, name));
    await writeFile(path.join(outputDirectory, name), content);
    sources[name] = hash(content);
  }
  await copyFile(path.join(outputDirectory, "Info.plist"), path.join(app, "Contents", "Info.plist"));
  const target = process.arch === "arm64" ? "arm64-apple-macosx12.0" : "x86_64-apple-macosx12.0";
  await run("xcrun", [
    "swiftc", "-target", target, "-swift-version", "5", "-parse-as-library", "-warnings-as-errors",
    path.join(outputDirectory, "Probe.swift"), "-o", path.join(bin, "probe"),
    "-framework", "AppKit", "-framework", "WebKit",
  ], options);
  await run("codesign", ["--force", "--sign", "-", app], options);
  const { startFixture } = await import(pathToFileURL(path.join(outputDirectory, "fixture.mjs")).href);
  const { assessReport } = await import(pathToFileURL(path.join(outputDirectory, "report.mjs")).href);
  fixture = await startFixture();
  const resultPath = path.join(outputDirectory, "results.json");
  console.log("Results: " + resultPath);
  if (mode === "restricted") {
    console.log("The restricted permission checks run automatically.");
  } else {
    console.log("Click Request screen. Cancel any screen picker or OS prompt without granting access. Scroll the page, then click Finish checks.");
  }

  const child = await run(path.join(bin, "probe"), [String(fixture.port), resultPath, ...flags], options);
  if (child.stderr) process.stderr.write(child.stderr);
  const report = JSON.parse(await readFile(resultPath, "utf8"));
  report.assessment = assessReport(report, mode);
  report.harness = {
    collectedAt: new Date().toISOString(),
    arch: process.arch,
    target,
    node: process.version,
    sources,
    sourceSha256: sources["Probe.swift"],
    fixtureSha256: sources["fixture.mjs"],
    screenSPI: mode === "screen-spi",
    restricted: mode === "restricted",
  };
  await writeFile(resultPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (report.assessment.status !== "pass") process.exitCode = 2;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (fixture) {
    fixture.server.closeAllConnections();
    await new Promise(resolve => fixture.server.close(resolve));
  }
}
