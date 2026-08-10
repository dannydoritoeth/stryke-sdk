import { beforeEach, describe, expect, it, vi } from "vitest";

type Scenario = {
  tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }>;
  results: Record<string, unknown>;
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
  closed: number;
};

const scenario = vi.hoisted<Scenario>(() => ({ tools: [], results: {}, calls: [], closed: 0 }));

vi.mock("@modelcontextprotocol/client", () => ({
  StreamableHTTPClientTransport: class {
    constructor(readonly endpoint: URL) {}
  },
  Client: class {
    async connect(): Promise<void> {}
    async close(): Promise<void> { scenario.closed += 1; }
    async listTools(): Promise<{ tools: Scenario["tools"] }> { return { tools: scenario.tools }; }
    getNegotiatedProtocolVersion(): string { return "2025-11-25"; }
    getServerVersion(): { name: string; version: string } { return { name: "stryke-read-only", version: "test" }; }
    async callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<{ structuredContent: unknown }> {
      scenario.calls.push(input);
      return { structuredContent: scenario.results[input.name] };
    }
  },
}));

import {
  STRYKE_MCP_TOOL_NAMES,
  StrykeMcpToolError,
  StrykeReadOnlyMcpClient,
} from "../src/index.js";

const readOnlyTools = () => STRYKE_MCP_TOOL_NAMES.map((name) => ({
  name,
  annotations: { readOnlyHint: true, destructiveHint: false },
}));

describe("anonymous read-only MCP client", () => {
  beforeEach(() => {
    scenario.tools = readOnlyTools();
    scenario.results = {};
    scenario.calls = [];
    scenario.closed = 0;
  });

  it("executes the documented discovery, detail, and preview flow with one dynamic market id", async () => {
    scenario.results = {
      stryke_get_environment: { ok: true, data: { anonymous: true, readOnly: true, toolCount: 4 } },
      stryke_get_current_pyth_markets: { ok: true, data: { markets: [{ marketId: "dynamic-market" }] } },
      stryke_get_market: { ok: true, data: { market: { marketId: "dynamic-market" } } },
      stryke_preview_quote: { ok: true, data: { marketId: "dynamic-market", input: { value: "0.01", unit: "SOL", baseUnits: "10000000" } } },
    };
    const client = await StrykeReadOnlyMcpClient.connect();
    expect(client.protocolVersion).toBe("2025-11-25");
    expect(client.serverInfo.name).toBe("stryke-read-only");
    await client.getEnvironment();
    const current = await client.getCurrentPythMarkets({ symbol: "BTC", state: "tradable" });
    const marketId = current.markets[0]?.marketId;
    expect(marketId).toBe("dynamic-market");
    await client.getMarket(marketId!);
    await client.previewQuote({ marketId: marketId!, action: "buy", side: "up", amount: { value: "0.01", unit: "SOL" } });
    await client.close();
    expect(scenario.calls.map(({ name }) => name)).toEqual(STRYKE_MCP_TOOL_NAMES);
    expect(scenario.calls.at(-1)?.arguments).toMatchObject({ marketId: "dynamic-market" });
    expect(scenario.closed).toBe(1);
  });

  it("fails closed and closes when the tool surface changes or loses read-only safety", async () => {
    scenario.tools = readOnlyTools().slice(0, 3);
    await expect(StrykeReadOnlyMcpClient.connect()).rejects.toMatchObject({ code: "compatibility", retryable: false });
    expect(scenario.closed).toBe(1);

    scenario.closed = 0;
    scenario.tools = readOnlyTools();
    scenario.tools[0]!.annotations!.readOnlyHint = false;
    await expect(StrykeReadOnlyMcpClient.connect()).rejects.toMatchObject({ code: "compatibility", retryable: false });
    expect(scenario.closed).toBe(1);
  });

  it("preserves structured retry guidance", async () => {
    scenario.results.stryke_get_current_pyth_markets = {
      ok: false,
      error: { code: "rate_limited", message: "retry later", retryable: true, retryAfterMs: 1250, remediation: "Wait before retrying." },
    };
    const client = await StrykeReadOnlyMcpClient.connect();
    await expect(client.getCurrentPythMarkets({ symbol: "BTC" })).rejects.toEqual(
      expect.objectContaining({ code: "rate_limited", retryable: true, retryAfterMs: 1250, remediation: "Wait before retrying." })
    );
  });

  it("rejects mismatched amount units and mutation material", async () => {
    const client = await StrykeReadOnlyMcpClient.connect();
    await expect(client.previewQuote({ marketId: "market", action: "buy", side: "up", amount: { value: "1", unit: "shares" } }))
      .rejects.toBeInstanceOf(StrykeMcpToolError);

    scenario.results.stryke_get_market = { ok: true, data: { signedTransaction: "unexpected" } };
    await expect(client.getMarket("market")).rejects.toMatchObject({ code: "compatibility", retryable: false });
  });
});
