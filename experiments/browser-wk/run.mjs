import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const directory = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const options = { signal: controller.signal, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 };
const hash = content => createHash("sha256").update(content).digest("hex");
let fixture;
let outputDirectory;
let executable;

try {
  if (process.platform !== "darwin") throw new Error("This spike requires macOS and Xcode.");
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(argument => !["--usage-strings", "--camera-only", "--microphone-only"].includes(argument))) {
    throw new Error("Usage: node experiments/browser-wk/run.mjs [--usage-strings | --camera-only | --microphone-only]");
  }
  const mode = flags[0]?.slice(2) ?? "zorvo";
  outputDirectory = await mkdtemp(path.join(os.tmpdir(), "zorvo-browser-wk-"));
  const app = path.join(outputDirectory, "Zorvo Browser Spike.app");
  const bin = path.join(app, "Contents", "MacOS");
  await mkdir(bin, { recursive: true });

  const sources = {};
  for (const name of ["Probe.swift", "HiddenProbe.swift", "Fixture.tsx", "fixture.mjs", "Info.plist", "run.mjs", "report.mjs"]) {
    const content = await readFile(path.join(directory, name));
    await writeFile(path.join(outputDirectory, name), content);
    sources[name] = hash(content);
  }
  const built = await build({
    configFile: false,
    logLevel: "warn",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [react()],
    resolve: { alias: ["react", "react/jsx-runtime", "react-dom/client"].map(name => ({
      find: new RegExp("^" + name + "$"),
      replacement: fileURLToPath(import.meta.resolve(name)),
    })) },
    build: {
      write: false, target: "safari15", reportCompressedSize: false,
      lib: { entry: path.join(outputDirectory, "Fixture.tsx"), name: "ZorvoFixture", formats: ["iife"] },
    },
  });
  const outputs = (Array.isArray(built) ? built : [built]).flatMap(result => result.output);
  const entry = outputs.find(output => output.type === "chunk" && output.isEntry);
  if (!entry) throw new Error("The React fixture build produced no entry script.");
  await writeFile(path.join(outputDirectory, "fixture.bundle.js"), entry.code);
  sources["fixture.bundle.js"] = hash(entry.code);

  const bundleInfo = path.join(app, "Contents", "Info.plist");
  await copyFile(path.join(outputDirectory, "Info.plist"), bundleInfo);
  await run("plutil", ["-replace", "CFBundleIdentifier", "-string", "xyz.zorvo.browser-spike." + mode, bundleInfo], options);
  const usageStrings = [];
  if (["usage-strings", "camera-only"].includes(mode)) usageStrings.push("NSCameraUsageDescription");
  if (["usage-strings", "microphone-only"].includes(mode)) usageStrings.push("NSMicrophoneUsageDescription");
  for (const key of usageStrings) {
    await run("plutil", ["-insert", key, "-string", "This test verifies that device capture is denied.", bundleInfo], options);
  }
  const target = process.arch === "arm64" ? "arm64-apple-macosx12.0" : "x86_64-apple-macosx12.0";
  executable = path.join(bin, "probe");
  await run("xcrun", [
    "swiftc", "-target", target, "-swift-version", "5", "-parse-as-library", "-warnings-as-errors",
    path.join(outputDirectory, "Probe.swift"), path.join(outputDirectory, "HiddenProbe.swift"),
    "-o", executable, "-framework", "AppKit", "-framework", "WebKit", "-framework", "AVFoundation",
  ], options);
  await run("codesign", ["--force", "--sign", "-", app], options);
  const { startFixture } = await import(pathToFileURL(path.join(outputDirectory, "fixture.mjs")).href);
  const { assessReport } = await import(pathToFileURL(path.join(outputDirectory, "report.mjs")).href);
  fixture = await startFixture({ script: entry.code });
  const resultPath = path.join(outputDirectory, "results.json");
  console.log("Results: " + resultPath);
  console.log("Mode: " + mode + ". Permission and background-React measurements run automatically.");
  const child = await run("open", ["-W", "-n", "--stdout", path.join(outputDirectory, "stdout.log"),
    "--stderr", path.join(outputDirectory, "stderr.log"), app,
    "--args", String(fixture.port), resultPath, mode], options);
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  const report = JSON.parse(await readFile(resultPath, "utf8"));
  report.assessment = assessReport(report, mode);
  report.harness = {
    collectedAt: new Date().toISOString(), arch: process.arch, target, node: process.version,
    sources, bundleInfoSha256: hash(await readFile(bundleInfo)), usageStrings,
    launch: "LaunchServices via open -W -n",
  };
  await writeFile(resultPath, JSON.stringify(report, null, 2) + "\n");
  console.log("Assessment: " + report.assessment.status);
  if (report.assessment.status !== "pass") process.exitCode = 2;
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (outputDirectory && executable) {
    try {
      const pid = Number(await readFile(path.join(outputDirectory, "probe.pid"), "utf8"));
      if (Number.isInteger(pid) && pid > 1) {
        const command = await run("ps", ["-ww", "-p", String(pid), "-o", "args="], { timeout: 3000 });
        if (command.stdout.trim().startsWith(await realpath(executable) + " ")) process.kill(pid, "SIGTERM");
      }
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code) && error.code !== 1) console.error("Test process cleanup failed. " + error.message);
    }
  }
  if (fixture) {
    fixture.server.closeAllConnections();
    await new Promise(resolve => fixture.server.close(resolve));
  }
}
