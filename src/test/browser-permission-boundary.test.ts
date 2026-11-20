import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

describe("browser capture permission boundary", () => {
  it.each(["src-tauri/Info.plist", "experiments/browser-wk/Info.plist"])(
    "%s keeps the ordinary bundle free of device usage declarations",
    file => {
      const plist = readFileSync(join(root, file), "utf8");
      for (const key of ["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSLocationUsageDescription"]) {
        expect(plist, file).not.toContain(`<key>${key}</key>`);
      }
    },
  );
});
