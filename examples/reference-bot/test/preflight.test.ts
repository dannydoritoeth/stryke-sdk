import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrykeSdkError } from "@stryketrade/sdk";

import {
  EXECUTION_BUFFER_LAMPORTS,
  emitPreflight,
  requiredExecutionBalance,
  requireRootEnvFile,
  runContinuousMarketPreflight,
  runPreflightCheck,
} from "../src/preflight.js";

describe("reference bot startup preflight", () => {
  afterEach(() => vi.restoreAllMocks());

  it("continuous runtime treats retryable startup market absence as waiting", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => output.push(String(line)));
    await expect(runContinuousMarketPreflight("live", async () => {
      throw new StrykeSdkError(
        "source_unavailable",
        "Requested pilot market is unavailable",
        true
      );
    })).resolves.toBe("waiting");
    expect(output.map((line) => JSON.parse(line))).toContainEqual(expect.objectContaining({
      event: "reference_bot_preflight",
      check: "market",
      status: "skipped",
      message: expect.stringContaining("continuous runtime will retry"),
    }));
  });

  it("continuous runtime still blocks incompatible startup market responses", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(runContinuousMarketPreflight("live", async () => {
      throw new StrykeSdkError(
        "compatibility",
        "Unsupported market contract"
      );
    })).rejects.toMatchObject({ code: "compatibility" });
  });

  it("cli_missing_env_prints_copy_command_before_startup", () => {
    const root = mkdtempSync(join(tmpdir(), "stryke-missing-env-"));
    const prior = process.env.INIT_CWD;
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => output.push(String(line)));
    process.env.INIT_CWD = root;
    try {
      expect(() => requireRootEnvFile("paper")).toThrow(/cp \.env\.example \.env/);
      expect(output).toHaveLength(1);
      expect(JSON.parse(output[0]!)).toMatchObject({
        event: "reference_bot_preflight",
        check: "environment",
        status: "failed",
      });
      expect(output[0]).toContain("cp .env.example .env");
    } finally {
      if (prior === undefined) delete process.env.INIT_CWD;
      else process.env.INIT_CWD = prior;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("paper_preflight_skips_wallet_rpc_and_funding", () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => output.push(String(line)));
    emitPreflight("paper", "wallet", "skipped", "Paper mode never loads a wallet.");
    emitPreflight("paper", "rpc", "skipped", "Paper mode makes no wallet RPC checks.");
    emitPreflight("paper", "funding", "skipped", "Paper mode requires no wallet funding.");
    expect(output.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ check: "wallet", status: "skipped" }),
      expect.objectContaining({ check: "rpc", status: "skipped" }),
      expect.objectContaining({ check: "funding", status: "skipped" }),
    ]);
  });

  it("signed_preflight_requires_trade_cap_plus_execution_buffer", () => {
    expect(requiredExecutionBalance(1_000_000n)).toBe(1_000_000n + EXECUTION_BUFFER_LAMPORTS);
  });

  it("devnet_rpc_preflight_retries_a_transient_fetch_failure", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => output.push(String(line)));
    const operation = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue(123);

    await expect(
      runPreflightCheck(
        "devnet",
        "rpc",
        "Connected.",
        "Check RPC.",
        operation,
        { attempts: 3 }
      )
    ).resolves.toBe(123);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(output.map((line) => JSON.parse(line).status)).toEqual([
      "checking",
      "passed",
    ]);
  });

  it("fails a hanging preflight operation within its bounded attempt timeout", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(
      runPreflightCheck(
        "devnet",
        "rpc",
        "Connected.",
        "Check RPC.",
        () => new Promise<number>(() => undefined),
        { attemptTimeoutMs: 10 }
      )
    ).rejects.toThrow("rpc preflight timed out after 10ms");
  });

  it("preflight_output_never_exposes_key_material", () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => output.push(String(line)));
    emitPreflight("devnet", "wallet", "failed", "Keypair is malformed.", "Regenerate it with solana-keygen.");
    expect(output.join("\n")).not.toMatch(/\[12,34,56\]|private key|secret key/i);
  });
});
