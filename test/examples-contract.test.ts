import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workspace = new URL("..", import.meta.url).pathname;

describe("documented example contract", () => {
  it("documented_read_only_command_runs_without_wallet", () => {
    const result = spawnSync("npm", ["run", "start:read-only", "-w", "@stryke/reference-bot"], { cwd: workspace, encoding: "utf8", env: { ...process.env, STRYKE_WALLET_ADAPTER_PATH: "" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"action":"dry_run"');
    expect(result.stdout).toContain('"event":"stryke_compatibility"');
  }, 30_000);

  it("documented_custom_estimator_compiles", () => {
    const quickstart = readFileSync(join(workspace, "docs/quickstart.md"), "utf8");
    const snippet = [...quickstart.matchAll(/```ts\n([\s\S]*?)\n```/g)]
      .map((match) => match[1])
      .find((candidate) => candidate?.includes("estimateFairProbability"));
    expect(snippet).toBeTruthy();
    const directory = mkdtempSync(join(tmpdir(), "stryke-estimator-"));
    try {
      const file = join(directory, "strategy.ts");
      writeFileSync(file, snippet!);
      execFileSync(join(workspace, "node_modules/.bin/tsc"), ["--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", file], { cwd: workspace, stdio: "pipe" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("documented_live_command_refuses_without_explicit_gates", () => {
    const env = { ...process.env };
    delete env.STRYKE_READ_ONLY_MODE;
    delete env.STRYKE_LIVE_TRADING_ENABLED;
    delete env.STRYKE_KILL_SWITCH_ENABLED;
    delete env.STRYKE_WALLET_ADAPTER_PATH;
    const result = spawnSync("npm", ["run", "start:live", "-w", "@stryke/reference-bot"], { cwd: workspace, encoding: "utf8", env });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"event":"reference_bot_error"');
    expect(result.stderr).not.toMatch(/seed phrase|private key|secret key/i);
  }, 30_000);
});
