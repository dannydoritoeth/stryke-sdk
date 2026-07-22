import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("reference bot architecture", () => {
  it("uses_sdk_exports_without_duplicate_transport_or_transaction_logic", () => {
    const sourceDirectory = new URL("../src/", import.meta.url);
    const source = readdirSync(sourceDirectory)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(new URL(file, sourceDirectory), "utf8"))
      .join("\n");
    expect(source).toContain('from "@stryke/sdk"');
    expect(source).not.toMatch(/\bfetch\s*\(|new WebSocket|new EventSource|sendRawTransaction|confirmTransaction/);
  });
});
