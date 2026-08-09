import { describe, expect, it } from "vitest";

import { StrykeSdkError } from "@stryketrade/sdk";
import { parseReferenceBotConfig } from "../src/config.js";
import { classifyDoctorError, classifyDoctorEvaluation, doctorExitCode } from "../src/doctor.js";
import { quote } from "./fixtures.js";

const config = parseReferenceBotConfig({ strategy: "polymarket_early" });
const market = (overrides: Record<string, unknown> = {}) => ({
  marketId: "btc-5m",
  intervalStartTs: 1_000,
  expiryTs: 1_300,
  minimumTradeCollateralUnits: "10000",
  reference: { alignmentStatus: "aligned", status: "locked" },
  ...overrides,
});
const evaluation = (overrides: Record<string, unknown> = {}) => ({
  market: market({
    intervalStartTs: 1_000,
    expiryTs: 1_300,
    reference: { alignmentStatus: "aligned", status: "locked" },
  }),
  estimatorInput: { currentPrice: 100, strikePrice: 100, secondsRemaining: 200, priceHistory: [] },
  buyQuotes: [quote({ side: "yes", amount: "10000", marketStateVersion: "same", closingProtection: { ...quote().closingProtection, closingStartsAt: 1_250 } }), quote({ side: "no", amount: "10000", marketStateVersion: "same", closingProtection: { ...quote().closingProtection, closingStartsAt: 1_250 } })],
  proposedSizeLamports: 10_000n,
  aggregateExposureLamports: 0n,
  openPositions: 0,
  dataFresh: true,
  polymarketPrices: { yes: {}, no: {} },
  ...overrides,
}) as never;

describe("reference bot doctor", () => {
  it("returns_ready_only_after_matched_quotes_and_strategy_inputs", () => {
    expect(classifyDoctorEvaluation({ profile: "paper", config, evaluation: evaluation(), nowSeconds: 1_030 })).toMatchObject({ status: "READY_FOR_PAPER", reason: "all_readiness_checks_passed", configuredTradeSizeLamports: "10000", quoteIds: ["quote-1", "quote-1"] });
    expect(classifyDoctorEvaluation({ profile: "live", config, evaluation: evaluation(), nowSeconds: 1_030 }).status).toBe("READY_FOR_LIVE");
  });

  it("distinguishes_healthy_alignment_and_timing_waits", () => {
    const degraded = evaluation({ market: market({ expiryTs: 1_300, reference: { alignmentStatus: "degraded", status: "locked", fallbackReason: "opening_snapshot_missing" } }) });
    expect(classifyDoctorEvaluation({ profile: "paper", config, evaluation: degraded, nowSeconds: 1_030 })).toMatchObject({ status: "WAITING_FOR_MARKET", reason: "opening_snapshot_missing", nextEligibleAt: 1_300 });
    expect(classifyDoctorEvaluation({ profile: "paper", config, evaluation: evaluation(), nowSeconds: 1_100 })).toMatchObject({ status: "WAITING_FOR_MARKET", reason: "entry_window_closed", nextEligibleAt: 1_300 });
  });

  it("blocks_inconsistent_quotes_and_authoritative_minimum_failures", () => {
    const mismatched = evaluation({ buyQuotes: [quote({ side: "yes", amount: "10000", marketStateVersion: "a" }), quote({ side: "no", amount: "10000", marketStateVersion: "b" })] });
    expect(() => classifyDoctorEvaluation({ profile: "paper", config, evaluation: mismatched, nowSeconds: 1_030 })).toThrow(/Matched YES\/NO/);
    expect(classifyDoctorError("paper", new StrykeSdkError("quote_blocked", "missing", true, { phase: "market_minimum_unavailable" })).status).toBe("BLOCKED");
  });

  it("directs_an_unconfigured_live_user_to_the_example_environment", () => {
    expect(classifyDoctorError("live", new StrykeSdkError("configuration", "Invalid reference bot config: STRYKE_ASSET"))).toMatchObject({
      status: "BLOCKED",
      reason: "configuration",
      remediation: expect.stringContaining("Copy .env.example to .env"),
    });
  });

  it("uses_stable_exit_codes", () => {
    expect(doctorExitCode("READY_FOR_PAPER")).toBe(0);
    expect(doctorExitCode("READY_FOR_LIVE")).toBe(0);
    expect(doctorExitCode("WAITING_FOR_MARKET")).toBe(2);
    expect(doctorExitCode("BLOCKED")).toBe(1);
  });
});
