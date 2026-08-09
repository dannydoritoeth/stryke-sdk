import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("reference bot architecture", () => {
  it("uses_sdk_exports_without_duplicate_transport_or_transaction_logic", () => {
    const sourceDirectory = new URL("../src/", import.meta.url);
    const source = readdirSync(sourceDirectory)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(new URL(file, sourceDirectory), "utf8"))
      .join("\n");
    expect(source).toContain('from "@stryketrade/sdk"');
    expect(source).not.toMatch(/\bfetch\s*\(|new WebSocket|new EventSource|sendRawTransaction|confirmTransaction/);
  });

  it("runs_the_prebuilt_live_artifact_without_building_at_process_start", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["start:live:built"]).toBe(
      "node dist/cli.js --profile=live"
    );
  });
});
