import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

describe("browser capture permission boundary", () => {
  it("keeps the app bundle free of device usage declarations", () => {
    const file = "src-tauri/Info.plist";
    const plist = readFileSync(join(root, file), "utf8");
    for (const key of ["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSLocationUsageDescription"]) {
      expect(plist, file).not.toContain(`<key>${key}</key>`);
    }
  });
});
