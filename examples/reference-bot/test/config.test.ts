import { describe, expect, it, vi } from "vitest";

import { parseReferenceBotConfig, parseReferenceBotEnv, referenceBotDefaults } from "../src/config.js";
import { loadWalletForLiveTrading } from "../src/wallet.js";

describe("reference bot config", () => {
  it("defaults_read_only_live_off_and_kill_switch_on", () => {
    expect(referenceBotDefaults).toMatchObject({ readOnlyMode: true, liveTradingEnabled: false, killSwitchEnabled: true });
  });

  it("kill_switch_overrides_live_enablement", async () => {
    const loader = vi.fn();
    await expect(loadWalletForLiveTrading(parseReferenceBotConfig({ readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: true }), loader)).resolves.toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
  });

  it("read_only_mode_never_loads_wallet", async () => {
    const loader = vi.fn();
    await loadWalletForLiveTrading(parseReferenceBotConfig({ liveTradingEnabled: true, killSwitchEnabled: false }), loader);
    expect(loader).not.toHaveBeenCalled();
  });

  it("invalid_units_bounds_or_conflicting_signers_fail_closed", () => {
    for (const invalid of [
      { maximumTradeSizeLamports: 0n },
      { maximumPriceImpactBps: 10_001 },
      { minimumSecondsToExpiry: 1.5 },
      { maximumOpenPositions: 0 },
      { privateKey: "nope", walletAdapterPath: "./wallet.js" },
    ]) expect(() => parseReferenceBotConfig(invalid)).toThrow();
  });

  it("aggregate_exposure_must_cover_per_trade_cap", () => {
    expect(() => parseReferenceBotConfig({ tradeSizeLamports: 1n, maximumTradeSizeLamports: 2n, maximumAggregateExposureLamports: 1n })).toThrow(/maximumAggregateExposureLamports/);
  });

  it("parses_exact_decimal_sol_and_all_runtime_controls", () => {
    const config = parseReferenceBotEnv({
      STRYKE_ASSET: "SOL", STRYKE_EXPIRY_FAMILY: "one_minute", STRYKE_SIDE: "no",
      STRYKE_ESTIMATOR: "distance_momentum", STRYKE_TRADE_SIZE_SOL: "0.001000001",
      STRYKE_MAXIMUM_TRADE_SIZE_SOL: "0.002", STRYKE_MAXIMUM_AGGREGATE_EXPOSURE_SOL: "0.003",
      STRYKE_MINIMUM_ENTRY_EDGE_BPS: "7", STRYKE_MAXIMUM_PRICE_IMPACT_BPS: "8",
      STRYKE_MINIMUM_SECONDS_TO_EXPIRY: "9", STRYKE_MAXIMUM_OPEN_POSITIONS: "2",
      STRYKE_TICK_INTERVAL_MS: "1000", STRYKE_STOP_LOSS_BPS: "10", STRYKE_TAKE_PROFIT_BPS: "11",
      STRYKE_PRICE_HISTORY_MAX_POINTS: "12", STRYKE_READ_ONLY_MODE: "true",
      STRYKE_LIVE_TRADING_ENABLED: "false", STRYKE_KILL_SWITCH_ENABLED: "true",
    });
    expect(config).toMatchObject({ asset: "SOL", expiryFamily: "one_minute", side: "no", estimator: "distance_momentum", tradeSizeLamports: 1_000_001n, minimumEntryEdgeBps: 7, tickIntervalMs: 1000, stopLossBps: 10, takeProfitBps: 11 });
  });

  it("active_live_requires_every_explicit_control_before_wallet_or_api_work", () => {
    expect(() => parseReferenceBotEnv({ STRYKE_READ_ONLY_MODE: "false", STRYKE_LIVE_TRADING_ENABLED: "true", STRYKE_KILL_SWITCH_ENABLED: "false" })).toThrow(/STRYKE_ASSET/);
  });
});
