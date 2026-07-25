import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const workspace = new URL("..", import.meta.url).pathname;
const adapter = join(workspace, "examples/reference-bot/wallet-adapter.example.mjs");
const directories: string[] = [];

const importAdapter = (keypairPath: string) => spawnSync(
  process.execPath,
  ["--input-type=module", "--eval", `import(${JSON.stringify(adapter)})`],
  { encoding: "utf8", env: { ...process.env, STRYKE_WALLET_KEYPAIR_PATH: keypairPath } }
);

describe("example wallet adapter diagnostics", () => {
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("devnet_preflight_reports_unreadable_keypair_remediation", () => {
    const result = importAdapter("/definitely/missing/stryke-devnet-wallet.json");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot read STRYKE_WALLET_KEYPAIR_PATH");
    expect(result.stderr).toContain("solana-keygen");
  });

  it("devnet_preflight_reports_malformed_keypair_without_contents", () => {
    const directory = mkdtempSync(join(tmpdir(), "stryke-wallet-"));
    directories.push(directory);
    const file = join(directory, "wallet.json");
    const recognizableSecret = "recognizable-secret-wallet-material";
    writeFileSync(file, recognizableSecret);
    const result = importAdapter(file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not valid JSON");
    expect(result.stderr).toContain("solana-keygen");
    expect(result.stderr).not.toContain(recognizableSecret);
  });
});
