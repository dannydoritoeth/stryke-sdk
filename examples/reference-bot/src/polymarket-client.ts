import { StrykeSdkError } from "@stryke/sdk";

export type PolymarketExecutablePrice = {
  tokenId: string;
  bidBps: number;
  askBps: number;
  spreadBps: number;
  observedAtMs: number;
};

type FetchLike = typeof fetch;

const probabilityBps = (value: unknown, field: string): number => {
  if (typeof value !== "string" || !/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)) {
    throw new StrykeSdkError("validation", `Invalid Polymarket ${field}`);
  }
  const result = Math.round(Number(value) * 10_000);
  if (result < 0 || result > 10_000) throw new StrykeSdkError("validation", `Invalid Polymarket ${field}`);
  return result;
};

export class PolymarketClient {
  constructor(
    private readonly endpoint = "https://clob.polymarket.com",
    private readonly request: FetchLike = fetch,
    private readonly now: () => number = Date.now
  ) {}

  async executablePrice(tokenId: string, options: {
    timeoutMs: number;
    maximumAgeMs: number;
    maximumSpreadBps: number;
  }): Promise<PolymarketExecutablePrice> {
    if (!tokenId) throw new StrykeSdkError("validation", "Polymarket token identity is missing");
    const url = new URL("/book", this.endpoint);
    url.searchParams.set("token_id", tokenId);
    let response: Response;
    try {
      response = await this.request(url, { signal: AbortSignal.timeout(options.timeoutMs), headers: { accept: "application/json" } });
    } catch {
      throw new StrykeSdkError("source_unavailable", "Polymarket pricing is unavailable", true);
    }
    if (!response.ok) throw new StrykeSdkError("source_unavailable", `Polymarket pricing failed (${response.status})`, response.status === 429 || response.status >= 500);
    const row = await response.json() as Record<string, unknown>;
    if (row.asset_id !== tokenId || !Array.isArray(row.bids) || !Array.isArray(row.asks)) {
      throw new StrykeSdkError("validation", "Polymarket order book identity is inconsistent");
    }
    const bids = row.bids.map((level) => probabilityBps((level as Record<string, unknown>).price, "bid"));
    const asks = row.asks.map((level) => probabilityBps((level as Record<string, unknown>).price, "ask"));
    if (bids.length === 0 || asks.length === 0) throw new StrykeSdkError("source_unavailable", "Polymarket executable price is unavailable", true);
    const bidBps = Math.max(...bids);
    const askBps = Math.min(...asks);
    const observedAtMs = typeof row.timestamp === "string" && /^\d+$/.test(row.timestamp) ? Number(row.timestamp) : NaN;
    const spreadBps = askBps - bidBps;
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs > this.now() + 1_000 || this.now() - observedAtMs > options.maximumAgeMs) {
      throw new StrykeSdkError("source_stale", "Polymarket executable price is stale", true);
    }
    if (spreadBps < 0 || spreadBps > options.maximumSpreadBps) {
      throw new StrykeSdkError("quote_blocked", "Polymarket spread exceeds the configured limit", true);
    }
    return { tokenId, bidBps, askBps, spreadBps, observedAtMs };
  }
}
