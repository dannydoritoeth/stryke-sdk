import { describe, expect, it } from "vitest";

import {
  PILOT_EXPIRY_FAMILIES,
  SUPPORTED_PROGRAM_ID,
  StrykeClient,
  StrykeSdkError,
} from "../src/index.js";

const capabilities = {
  apiVersion: "v1",
  schemaVersion: "1.0.0",
  apiServiceVersion: "0.4.2",
  compatibility: { minimumSdkVersion: "0.1.0" },
  cluster: "devnet",
  contract: {
    profile: "minimal_pyth",
    programId: SUPPORTED_PROGRAM_ID,
    programVersion: "0.1.0",
    idlSpecVersion: "0.1.0",
  },
  assets: [
    { symbol: "BTC", pythFeedId: "btc-feed" },
    { symbol: "SOL", pythFeedId: "sol-feed" },
  ],
  expiryFamilies: PILOT_EXPIRY_FAMILIES,
  actions: ["buy", "sell", "claim", "refund"],
};

const response = (body: unknown, version = "v1") =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "Stryke-Api-Version": version,
    },
  });

describe("SDK compatibility handshake", () => {
  it("accepts the exact supported API, program, cluster, asset, and expiry matrix", async () => {
    const client = await StrykeClient.connect({
      apiBaseUrl: "https://pilot.example",
      fetch: async () => response(capabilities),
    });
    expect(client.capabilities).toEqual(capabilities);
  });

  it.each([
    [{ ...capabilities, apiVersion: "v2" }, "v1"],
    [{ ...capabilities, schemaVersion: "2.0.0" }, "v1"],
    [{ ...capabilities, cluster: "mainnet-beta" }, "v1"],
    [
      { ...capabilities, contract: { ...capabilities.contract, programId: "wrong" } },
      "v1",
    ],
    [capabilities, "v2"],
  ])("rejects an unsupported compatibility combination", async (body, header) => {
    await expect(
      StrykeClient.connect({
        apiBaseUrl: "https://pilot.example",
        fetch: async () => response(body, header),
      })
    ).rejects.toBeInstanceOf(StrykeSdkError);
  });

  it("accepts additive v1 fields without changing the known contract", async () => {
    const client = await StrykeClient.connect({
      apiBaseUrl: "https://pilot.example",
      fetch: async () =>
        response({
          ...capabilities,
          futureOptionalDiagnostic: { enabled: true },
        }),
    });
    expect(client.capabilities).toEqual(capabilities);
    expect(client.capabilities).not.toHaveProperty("futureOptionalDiagnostic");
  });

  it("accepts_additional_configured_assets_and_their_expiry_matrix", async () => {
    const expanded = {
      ...capabilities,
      assets: [
        ...capabilities.assets,
        { symbol: "ETH", pythFeedId: "eth-feed", state: "enabled", enabledExpiryFamilies: ["five_minute", "fifteen_minute"] },
      ],
    };
    const client = await StrykeClient.connect({
      apiBaseUrl: "https://pilot.example",
      fetch: async () => response(expanded),
    });
    expect(client.capabilities.assets).toContainEqual(expanded.assets[2]);
  });

  it("rejects_duplicate_or_malformed_configured_assets", async () => {
    for (const asset of [
      { symbol: "BTC", pythFeedId: "duplicate" },
      { symbol: "eth", pythFeedId: "eth-feed" },
      { symbol: "ETH", pythFeedId: "" },
      { symbol: "ETH", pythFeedId: "eth-feed", enabledExpiryFamilies: ["daily"] },
    ]) {
      await expect(StrykeClient.connect({
        apiBaseUrl: "https://pilot.example",
        fetch: async () => response({ ...capabilities, assets: [...capabilities.assets, asset] }),
      })).rejects.toMatchObject({ code: "compatibility" });
    }
  });
});
