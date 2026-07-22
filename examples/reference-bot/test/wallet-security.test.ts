import { describe, expect, it, vi } from "vitest";

import { parseReferenceBotConfig } from "../src/config.js";
import { loadWalletForLiveTrading, PILOT_WALLET_GUIDANCE } from "../src/wallet.js";

describe("wallet security", () => {
  it("wallet_load_requires_all_live_gates", async () => {
    const loader = vi.fn().mockResolvedValue("wallet");
    const config = parseReferenceBotConfig({ readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false, walletAdapterPath: "./adapter.js" });
    await expect(loadWalletForLiveTrading(config, loader)).resolves.toBe("wallet");
    expect(loader).toHaveBeenCalledWith("./adapter.js");
  });

  it("inline_secret_or_seed_phrase_config_is_rejected", () => {
    expect(() => parseReferenceBotConfig({ seedPhrase: "twelve words" })).toThrow(/Inline wallet secrets/);
    expect(() => parseReferenceBotConfig({ secretKey: "bytes" })).toThrow(/Inline wallet secrets/);
  });

  it("separately_funded_wallet_guidance_is_present", () => expect(PILOT_WALLET_GUIDANCE).toMatch(/separately funded, minimally funded pilot wallet/i));
});
