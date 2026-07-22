import { describe, expect, it, vi } from "vitest";

import { parseReferenceBotConfig, referenceBotDefaults } from "../src/config.js";
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
      { maximumTradeSizeSol: 0 },
      { maximumPriceImpactBps: 10_001 },
      { minimumSecondsToExpiry: 1.5 },
      { maximumOpenPositions: 0 },
      { privateKey: "nope", walletAdapterPath: "./wallet.js" },
    ]) expect(() => parseReferenceBotConfig(invalid)).toThrow();
  });

  it("aggregate_exposure_must_cover_per_trade_cap", () => {
    expect(() => parseReferenceBotConfig({ maximumTradeSizeSol: 2, maximumAggregateExposureSol: 1 })).toThrow(/Aggregate exposure/);
  });
});
