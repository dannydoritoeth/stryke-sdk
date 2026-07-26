import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("reference bot strategy README claim", () => {
  it("readme_claim_is_blocked_until_evidence_matrix_complete", () => {
    expect(() => execFileSync(process.execPath, ["scripts/check-strategy-readme-claim.mjs"], { encoding: "utf8" })).not.toThrow();
  });
});
