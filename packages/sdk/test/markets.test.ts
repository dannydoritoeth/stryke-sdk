import { describe, expect, it } from "vitest";

import {
  MarketsClient,
  StrykeSdkError,
  parsePilotMarket,
  type PilotMarketLifecycleState,
} from "../src/index.js";

const lifecycle = (
  state: PilotMarketLifecycleState = "open",
  overrides: Record<string, unknown> = {}
) => ({
  schemaVersion: "stryke.pilotLifecycle.v1",
  state,
  rawStatus: "active",
  rawReason: `market_${state}`,
  observedAt: "2026-07-22T00:00:00.000Z",
  observedSlot: 123,
  ...overrides,
});

const expirySeconds = (expiryFamily: string) => ({
  one_minute: 60,
  five_minute: 300,
  fifteen_minute: 900,
  hourly: 3_600,
}[expiryFamily] ?? 300);

const row = (symbol: string, expiryFamily: string, expiryTs: number) => ({
  marketId: `pyth:${symbol}:${expiryFamily}:${expiryTs}`,
  assetRef: `${symbol.toLowerCase()}-feed`,
  tokenMint: "So11111111111111111111111111111111111111112",
  symbol,
  source: "pyth_oracle",
  collateral: { symbol: "SOL" },
  expiryFamily,
  expiryTs,
  intervalStartTs: Math.max(0, expiryTs - expirySeconds(expiryFamily)),
  intervalLifecycle: "active",
  targetValue: "70000",
  marketReference: expiryFamily === "one_minute" ? {
    assetKey: symbol.toLowerCase(),
    expiryFamily,
    intervalStartTs: Math.max(0, expiryTs - expirySeconds(expiryFamily)),
    intervalEndTs: expiryTs,
    policy: "stryke_open",
    alignmentStatus: "native",
    status: "locked",
    targetValue: "70000",
    targetDecimals: 8,
    observedAt: "2026-07-22T00:00:00.000Z",
  } : {
    assetKey: symbol.toLowerCase(),
    expiryFamily,
    intervalStartTs: Math.max(0, expiryTs - expirySeconds(expiryFamily)),
    intervalEndTs: expiryTs,
    policy: "polymarket",
    alignmentStatus: "aligned",
    status: "locked",
    targetValue: "70000",
    targetDecimals: 8,
    observedAt: "2026-07-22T00:00:00.000Z",
    externalVenue: "polymarket",
    externalMarketId: `poly-${symbol}-${expiryFamily}-${expiryTs}`,
    externalSlug: `${symbol.toLowerCase()}-${expiryFamily}-${expiryTs}`,
    upTokenId: "poly-up",
    downTokenId: "poly-down",
  },
  status: "open",
  rawStatus: "active",
  pilotLifecycle: lifecycle(),
  tradeability: {
    canQuote: true,
    canPrepareTransaction: true,
    disabledReasons: [],
  },
  selectedMarket: {
    pools: { yesPool: "200", noPool: "300", stale: false },
    activation: {
      yes: { activated: false, thresholdCollateralUnits: "10000000000", realPoolCollateralUnits: "200", feeModeForNextBuy: "activation_waived", feeModeForNextSell: "activation_waived" },
      no: { activated: false, thresholdCollateralUnits: "10000000000", realPoolCollateralUnits: "300", feeModeForNextBuy: "activation_waived", feeModeForNextSell: "activation_waived" },
    },
    odds: { yesBps: 4000, noBps: 6000 },
    tradeBounds: { minimumTradeCollateralUnits: "14000000" },
  },
});

const withTarget = <T extends ReturnType<typeof row>>(value: T, targetValue: string) => ({
  ...value,
  targetValue,
  marketReference: { ...value.marketReference, targetValue },
});

describe("pilot market discovery", () => {
  it("discovers_exact_btc_sol_expiry_matrix", async () => {
    const calls: string[] = [];
    const client = {
      requestJson: async (path: string) => {
        calls.push(path);
        const url = new URL(path, "https://pilot.example");
        const symbol = url.searchParams.get("symbol") as "BTC" | "SOL";
        const expiry = url.searchParams.get("expiryFamily")!;
        return {
          markets: [row(symbol, expiry, 1_800_000_000)],
          metadata: {
            contractVersion: "stryke.botMarket.v1",
            generatedAt: "2026-07-22T00:00:00.000Z",
            stale: false,
          },
        };
      },
    };
    const markets = new MarketsClient(client as never);

    for (const asset of ["BTC", "SOL"] as const) {
      for (const expiry of [
        "one_minute",
        "five_minute",
        "fifteen_minute",
        "hourly",
      ] as const) {
        await expect(markets.current(asset, expiry)).resolves.toMatchObject({
          asset,
          expiryFamily: expiry,
          source: "pyth_oracle",
          collateral: "SOL",
        });
      }
    }
    expect(calls).toHaveLength(8);
  });

  it("rejects_ambiguous_current_market", async () => {
    const client = {
      requestJson: async () => ({
        markets: [
          row("BTC", "five_minute", 1_800_000_000),
          row("BTC", "five_minute", 1_800_000_000),
        ],
        metadata: {
          contractVersion: "stryke.botMarket.v1",
          generatedAt: "2026-07-22T00:00:00.000Z",
          stale: false,
        },
      }),
    };
    await expect(
      new MarketsClient(client as never).current("BTC", "five_minute")
    ).rejects.toBeInstanceOf(StrykeSdkError);
  });

  it("ignores_non_solana_source_rows_when_selecting_the_current_market", async () => {
    const canonical = {
      ...row("BTC", "five_minute", 1_800_000_000),
      tokenMint: "So11111111111111111111111111111111111111112",
    };
    const client = {
      requestJson: async () => ({
        markets: [
          { ...withTarget(canonical, "7100000000000"), tokenMint: `0x${"a".repeat(64)}` },
          canonical,
        ],
        metadata: {
          contractVersion: "stryke.botMarket.v1",
          generatedAt: "2026-07-22T00:00:00.000Z",
          stale: false,
        },
      }),
    };

    await expect(
      new MarketsClient(client as never).current("BTC", "five_minute")
    ).resolves.toMatchObject({ strikePrice: "70000" });
  });

  it("selects_single_initializable_feed_identity_before_onchain_market_exists", async () => {
    const initializable = { ...row("BTC", "five_minute", 1_800_000_000), tokenMint: `0x${"a".repeat(64)}`, status: "initializable" };
    const client = { requestJson: async () => ({ markets: [initializable], metadata: { contractVersion: "stryke.botMarket.v1", generatedAt: "2026-07-22T00:00:00.000Z", stale: false } }) };
    await expect(new MarketsClient(client as never).current("BTC", "five_minute")).resolves.toMatchObject({ tokenMint: initializable.tokenMint, status: "initializable" });
  });

  it("multiple_non_tradeable_initializable_candidates_are_retryable_unavailable", async () => {
    const initializable = (targetValue: string) => ({
      ...withTarget(row("BTC", "five_minute", 1_800_000_000), targetValue),
      tokenMint: `0x${targetValue.padStart(64, "a")}`,
      status: "initializable",
      tradeability: { canQuote: false, canPrepareTransaction: false, disabledReasons: ["not_initialized"] },
    });
    const client = { requestJson: async () => ({ markets: [initializable("1"), initializable("2")], metadata: { contractVersion: "stryke.botMarket.v1", generatedAt: "2026-07-22T00:00:00.000Z", stale: false } }) };
    await expect(new MarketsClient(client as never).current("BTC", "five_minute")).rejects.toMatchObject({ code: "source_unavailable", retryable: true });
  });

  it("hourly_selects_the_single_locked_reference_instead_of_a_legacy_ladder", async () => {
    const referenced = row("SOL", "hourly", 1_800_000_000);
    const legacy = (targetValue: string) => ({
      ...referenced,
      targetValue,
      marketReference: undefined,
      status: "initializable",
      tradeability: { canQuote: false, canPrepareTransaction: false, disabledReasons: ["legacy_ladder"] },
    });
    const client = { requestJson: async () => ({
      markets: [legacy("70"), referenced, legacy("80")],
      metadata: { contractVersion: "stryke.botMarket.v1", generatedAt: "2026-07-22T00:00:00.000Z", stale: false },
    }) };
    await expect(new MarketsClient(client as never).current("SOL", "hourly")).resolves.toMatchObject({
      strikePrice: "70000",
      reference: { alignmentStatus: "aligned", externalVenue: "polymarket" },
    });
  });

  it("rejects_asset_feed_or_expiry_identity_mismatch", () => {
    expect(() => parsePilotMarket({ ...row("BTC", "five_minute", 1), symbol: "ETH" }, false))
      .toThrowError(expect.objectContaining({ code: "unsupported_asset" }));
    expect(() => parsePilotMarket({ ...row("BTC", "daily", 1) }, false))
      .toThrowError(expect.objectContaining({ code: "unsupported_expiry" }));
    expect(() => parsePilotMarket({ ...row("BTC", "five_minute", 1), source: "dex_snapshot" }, false))
      .toThrowError(expect.objectContaining({ code: "validation" }));
    expect(() => parsePilotMarket({ ...row("BTC", "five_minute", 1), collateral: { symbol: "USDC" } }, false))
      .toThrowError(expect.objectContaining({ code: "validation" }));
  });

  it("preserves_target_state_version_slot_and_raw_status", () => {
    expect(
      parsePilotMarket(row("BTC", "five_minute", 1_800_000_000), false, "2026-07-22T00:00:01.000Z")
    ).toMatchObject({
      strikePrice: "70000",
      strikePriceDecimal: 70000,
      rawStatus: "active",
      pools: { yes: "200", no: "300", stale: false },
      activation: {
        yes: { activated: false, realPoolCollateralUnits: "200", thresholdCollateralUnits: "10000000000" },
        no: { activated: false, realPoolCollateralUnits: "300", thresholdCollateralUnits: "10000000000" },
      },
      probability: { yesBps: 4000, noBps: 6000 },
      minimumTradeCollateralUnits: "14000000",
      generatedAt: "2026-07-22T00:00:01.000Z",
      lifecycle: {
        schemaVersion: "stryke.pilotLifecycle.v1",
        state: "open",
        rawReason: "market_open",
        observedAt: "2026-07-22T00:00:00.000Z",
        observedSlot: 123,
      },
    });
  });

  it("accepts_an_empty_trade_bounds_object_without_inventing_a_market_minimum", () => {
    const value = row("BTC", "five_minute", 1_800_000_000);
    const parsed = parsePilotMarket({
      ...value,
      selectedMarket: { ...value.selectedMarket, tradeBounds: {} },
    }, false);

    expect(parsed.minimumTradeCollateralUnits).toBeUndefined();
  });

  it("normalizes_upcoming_open_trading_closed_resolvable_and_terminal_states", () => {
    const states: PilotMarketLifecycleState[] = [
      "upcoming",
      "open",
      "trading_closed",
      "resolvable",
      "resolved_yes",
      "resolved_no",
      "refundable_underfunded",
      "refundable_zero_winner",
    ];
    for (const state of states) {
      const value = {
        ...row("BTC", "five_minute", 1_800_000_000),
        pilotLifecycle: lifecycle(state),
      };
      expect(parsePilotMarket(value, false).lifecycle.state).toBe(state);
    }
  });

  it("uses_chain_api_time_not_local_wall_clock_for_tradeability", async () => {
    const client = {
      requestJson: async () => ({
        markets: [row("BTC", "five_minute", 1)],
        metadata: {
          contractVersion: "stryke.botMarket.v1",
          generatedAt: "2026-07-22T00:00:00.000Z",
          stale: false,
        },
      }),
    };
    await expect(
      new MarketsClient(client as never).current("BTC", "five_minute")
    ).resolves.toMatchObject({ expiryTs: 1, lifecycle: { state: "open" } });
  });

  it("fails closed when market metadata is stale", async () => {
    const client = {
      requestJson: async () => ({
        markets: [row("BTC", "five_minute", 1_800_000_000)],
        metadata: {
          contractVersion: "stryke.botMarket.v1",
          generatedAt: "2026-07-22T00:00:00.000Z",
          stale: true,
        },
      }),
    };
    await expect(
      new MarketsClient(client as never).current("BTC", "five_minute")
    ).rejects.toMatchObject({ code: "source_stale", retryable: true });
  });

  it("hydrates_typed_pools_and_probability_from_authoritative_surface_link", async () => {
    const candidate = { ...row("BTC", "five_minute", 1_800_000_000), links: { surface: "/v1/markets/id/surface" } } as Record<string, unknown>;
    delete candidate.selectedMarket;
    const calls: string[] = [];
    const client = { requestJson: async (path: string) => {
      calls.push(path);
      return path.includes("/surface")
        ? { surface: { pools: { yesPool: "11", noPool: "12", stale: false }, activation: row("BTC", "five_minute", 1).selectedMarket.activation, odds: { yesBps: 4783, noBps: 5217 } }, metadata: { stale: false } }
        : { markets: [candidate], metadata: { contractVersion: "stryke.botMarket.v1", generatedAt: "2026-07-22T00:00:00.000Z", stale: false } };
    } };
    await expect(new MarketsClient(client as never).current("BTC", "five_minute")).resolves.toMatchObject({ pools: { yes: "11", no: "12" }, probability: { yesBps: 4783, noBps: 5217 } });
    expect(calls).toHaveLength(2);
  });

  it("allows_discovery_only_rows_without_activation_state", () => {
    const value = row("BTC", "five_minute", 1_800_000_000);
    expect(parsePilotMarket({
      ...value,
      selectedMarket: { pools: { yesPool: "0 SOL", noPool: "0 SOL", stale: false }, odds: value.selectedMarket.odds },
    }, false).activation).toBeUndefined();
  });

  it("exposes_native_aligned_and_degraded_reference_provenance", () => {
    expect(parsePilotMarket(row("BTC", "one_minute", 1_800_000_000), false).reference)
      .toMatchObject({ policy: "stryke_open", alignmentStatus: "native" });
    expect(parsePilotMarket(row("BTC", "five_minute", 1_800_000_000), false).reference)
      .toMatchObject({ policy: "polymarket", alignmentStatus: "aligned", externalVenue: "polymarket" });

    const fallback = row("SOL", "hourly", 1_800_000_000);
    expect(parsePilotMarket({
      ...fallback,
      marketReference: {
        ...fallback.marketReference,
        policy: "stryke_fallback",
        alignmentStatus: "degraded",
        externalVenue: undefined,
        externalMarketId: undefined,
        externalSlug: undefined,
        upTokenId: undefined,
        downTokenId: undefined,
        fallbackReason: "polymarket_unavailable_at_open",
      },
    }, false).reference).toMatchObject({
      policy: "stryke_fallback",
      alignmentStatus: "degraded",
      fallbackReason: "polymarket_unavailable_at_open",
    });
  });

  it("rejects_incomplete_or_inconsistent_reference_identity", () => {
    const aligned = row("BTC", "five_minute", 1_800_000_000);
    expect(() => parsePilotMarket({
      ...aligned,
      marketReference: { ...aligned.marketReference, upTokenId: undefined },
    }, false)).toThrowError(expect.objectContaining({ code: "validation" }));
    expect(() => parsePilotMarket({
      ...aligned,
      marketReference: { ...aligned.marketReference, targetValue: "70001" },
    }, false)).toThrowError(expect.objectContaining({ code: "validation" }));
    expect(() => parsePilotMarket({
      ...aligned,
      marketReference: { ...aligned.marketReference, status: "pending" },
    }, false)).toThrowError(expect.objectContaining({ code: "validation" }));
  });

  it("supports_new_capability_assets_without_an_sdk_release_and_rejects_absent_assets", async () => {
    let requests = 0;
    const client = {
      capabilities: {
        assets: [
          { symbol: "BTC", pythFeedId: "btc-feed" },
          { symbol: "SOL", pythFeedId: "sol-feed" },
          { symbol: "ETH", pythFeedId: "eth-feed" },
        ],
      },
      requestJson: async () => {
        requests += 1;
        return {
          markets: [row("ETH", "five_minute", 1_800_000_000)],
          metadata: { contractVersion: "stryke.botMarket.v1", generatedAt: "2026-07-22T00:00:00.000Z", stale: false },
        };
      },
    };
    await expect(new MarketsClient(client as never).current("ETH", "five_minute"))
      .resolves.toMatchObject({ asset: "ETH", reference: { alignmentStatus: "aligned" } });
    expect(requests).toBe(1);
    await expect(new MarketsClient(client as never).current("DOGE", "five_minute"))
      .rejects.toMatchObject({ code: "unsupported_asset" });
    expect(requests).toBe(1);
  });
});
