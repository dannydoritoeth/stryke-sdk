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
    expect(result.stdout).toContain('"effectiveFeeBps":0');
    expect(result.stdout).toContain('"tick":2,"phase":"entry","action":"blocked","reason":"trading_locked_until_settlement"');
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

  it("documented_live_command_refuses_without_mainnet_approval", () => {
    const env = { ...process.env };
    delete env.STRYKE_READ_ONLY_MODE;
    delete env.STRYKE_LIVE_TRADING_ENABLED;
    delete env.STRYKE_KILL_SWITCH_ENABLED;
    delete env.STRYKE_WALLET_ADAPTER_PATH;
    const result = spawnSync("npm", ["run", "start:live", "-w", "@stryke/reference-bot"], { cwd: workspace, encoding: "utf8", env });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"event":"reference_bot_error"');
    expect(result.stderr).toContain("Mainnet live trading is not approved");
    expect(result.stderr).not.toMatch(/seed phrase|private key|secret key/i);
  }, 30_000);

  it("three_mode_commands_load_the_root_env_file", () => {
    const manifest = JSON.parse(readFileSync(join(workspace, "examples/reference-bot/package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const [script, profile] of [["start:paper", "paper"], ["start:devnet", "devnet"], ["start:live", "live"]] as const) {
      expect(manifest.scripts[script]).toContain("--env-file-if-exists=../../.env");
      expect(manifest.scripts[script]).toContain(`--profile=${profile}`);
    }
  });

  it("documented_devnet_preflight_can_stop_before_the_loop", () => {
    const cli = readFileSync(join(workspace, "examples/reference-bot/src/cli.ts"), "utf8");
    const troubleshooting = readFileSync(join(workspace, "docs/troubleshooting.md"), "utf8");
    expect(cli).toContain('process.argv.includes("--preflight-only")');
    expect(cli.indexOf('process.argv.includes("--preflight-only")')).toBeLessThan(cli.indexOf("new FileActionCheckpointStore"));
    expect(troubleshooting).toContain("npm run start:devnet -w @stryke/reference-bot -- --preflight-only");
  });

  it("reference_bot_completes_two_early_market_cycles", () => {
    const result = spawnSync("npm", ["run", "test:polymarket-fixture", "-w", "@stryke/reference-bot"], { cwd: workspace, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    for (const expected of [
      "buy:polymarket_executable_edge",
      "hold:position_not_economically_complete",
      "sell:polymarket_convergence",
      "skip:same_round_reentry_blocked",
    ]) expect(result.stdout).toContain(expected);
    expect(result.stdout.match(/buy:polymarket_executable_edge/g)).toHaveLength(2);
  }, 30_000);

  it("reference_bot_completes_two_late_hold_and_settlement_cycles", () => {
    const result = spawnSync("npm", ["run", "test:polymarket-late-fixture", "-w", "@stryke/reference-bot"], { cwd: workspace, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    for (const expected of ["buy:polymarket_executable_edge", "hold:position_not_economically_complete", "claim:terminal_confirmed", "skip:same_round_reentry_blocked"]) expect(result.stdout).toContain(expected);
    expect(result.stdout.match(/buy:polymarket_executable_edge/g)).toHaveLength(2);
  }, 30_000);
});
