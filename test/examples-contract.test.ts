import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const workspace = new URL("..", import.meta.url).pathname;
const run = promisify(execFile);

describe("documented example contract", () => {
  it("documented_read_only_command_runs_without_wallet", async () => {
    const result = await run("npm", ["run", "start:read-only", "-w", "@stryketrade/reference-bot"], { cwd: workspace, encoding: "utf8", env: { ...process.env, STRYKE_WALLET_ADAPTER_PATH: "" } });
    expect(result.stdout).toContain('"action":"dry_run"');
    expect(result.stdout).toContain('"effectiveFeeBps":0');
    expect(result.stdout).toContain('"tick":2,"phase":"entry","action":"blocked","reason":"trading_locked_until_settlement"');
    expect(result.stdout).toContain('"event":"stryke_compatibility"');
  }, 60_000);

  it("documented_live_command_selects_the_mainnet_profile", () => {
    const manifest = JSON.parse(readFileSync(join(workspace, "examples/reference-bot/package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(manifest.scripts["start:live"]).toContain("--profile=live");
  });

  it("three_mode_commands_load_the_root_env_file", () => {
    const manifest = JSON.parse(readFileSync(join(workspace, "examples/reference-bot/package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const [script, profile] of [["start:paper", "paper"], ["start:devnet", "devnet"], ["start:live", "live"]] as const) {
      expect(manifest.scripts[script]).toContain("--env-file-if-exists=../../.env");
      expect(manifest.scripts[script]).toContain(`--profile=${profile}`);
    }
  });

  it("documented_mainnet_preflight_can_stop_before_the_loop", () => {
    const cli = readFileSync(join(workspace, "examples/reference-bot/src/cli.ts"), "utf8");
    const troubleshooting = readFileSync(join(workspace, "docs/troubleshooting.md"), "utf8");
    expect(cli).toContain('process.argv.includes("--preflight-only")');
    expect(cli.indexOf('process.argv.includes("--preflight-only")')).toBeLessThan(cli.indexOf("new FileActionCheckpointStore"));
    expect(troubleshooting).toContain("npx stryke-reference-bot --profile=live --preflight-only");
  });

  it("reference_bot_completes_two_early_market_cycles", async () => {
    const result = await run("npm", ["run", "test:polymarket-fixture", "-w", "@stryketrade/reference-bot"], { cwd: workspace, encoding: "utf8" });
    for (const expected of [
      "buy:polymarket_executable_edge",
      "hold:position_not_economically_complete",
      "sell:polymarket_convergence",
      "skip:same_round_reentry_blocked",
    ]) expect(result.stdout).toContain(expected);
    expect(result.stdout.match(/buy:polymarket_executable_edge/g)).toHaveLength(2);
  }, 30_000);

  it("reference_bot_completes_two_late_hold_and_settlement_cycles", async () => {
    const result = await run("npm", ["run", "test:polymarket-late-fixture", "-w", "@stryketrade/reference-bot"], { cwd: workspace, encoding: "utf8" });
    for (const expected of ["buy:polymarket_executable_edge", "hold:position_not_economically_complete", "claim:terminal_confirmed", "skip:same_round_reentry_blocked"]) expect(result.stdout).toContain(expected);
    expect(result.stdout.match(/buy:polymarket_executable_edge/g)).toHaveLength(2);
  }, 30_000);

  it("reference_bot_revalidates_once_and_preserves_the_decision_after_cli_restart", async () => {
    const result = await run("npm", ["run", "test:pre-fee-revalidation-fixture", "-w", "@stryketrade/reference-bot"], { cwd: workspace, encoding: "utf8" });
    expect(result.stdout).toContain("sell:polymarket_pre_fee_signal_changed");
    expect(result.stdout.match(/hold:position_not_economically_complete/g)).toHaveLength(2);
    expect(result.stdout).toContain("pre_fee_revalidation_already_completed");
  }, 30_000);

  it("reference_bot_bootstraps_an_exact_empty_market_through_two_cli_iterations", async () => {
    const result = await run("npm", ["run", "test:polymarket-bootstrap-fixture", "-w", "@stryketrade/reference-bot"], { cwd: workspace, encoding: "utf8" });
    expect(result.stdout).toContain("buy:polymarket_empty_market_bootstrap");
    expect(result.stdout).toContain("skip:same_round_reentry_blocked");
  }, 30_000);
});
