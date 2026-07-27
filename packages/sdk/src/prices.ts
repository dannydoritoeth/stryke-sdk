import { HermesClient } from "@pythnetwork/hermes-client";

import type { PilotAsset } from "./compatibility.js";
import { StrykeSdkError } from "./errors.js";

export const PYTH_FEED_IDS = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
} as const satisfies Record<PilotAsset, string>;

export type PricePoint = {
  asset: PilotAsset;
  feedId: string;
  price: number;
  publishTime: number;
};

export type PriceSourceState = "unavailable" | "reconnecting" | "available";

export type PriceStoreOptions = {
  staleAfterMs?: number;
  futureToleranceMs?: number;
  historyWindowMs?: number;
  maximumHistoryPoints?: number;
  now?: () => number;
};

export class PriceStore {
  private readonly points = new Map<PilotAsset, PricePoint[]>();
  private readonly states = new Map<PilotAsset, PriceSourceState>();
  private readonly now: () => number;
  private readonly staleAfterMs: number;
  private readonly futureToleranceMs: number;
  private readonly historyWindowMs: number;
  private readonly maximumHistoryPoints: number;

  constructor(options: PriceStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.staleAfterMs = options.staleAfterMs ?? 30_000;
    this.futureToleranceMs = options.futureToleranceMs ?? 2_000;
    this.historyWindowMs = options.historyWindowMs ?? 3_600_000;
    this.maximumHistoryPoints = options.maximumHistoryPoints ?? 4_096;
  }

  ingest(asset: PilotAsset, update: unknown): PricePoint {
    const parsed = parseHermesUpdate(asset, update);
    const ageMs = this.now() - parsed.publishTime * 1_000;
    if (ageMs < -this.futureToleranceMs || ageMs > this.staleAfterMs) {
      throw new StrykeSdkError(
        ageMs < 0 ? "validation" : "source_stale",
        ageMs < 0 ? "Pyth publish time is in the future" : "Pyth price is stale"
      );
    }
    const existing = this.points.get(asset) ?? [];
    const latest = existing.at(-1);
    if (latest && parsed.publishTime < latest.publishTime) {
      throw new StrykeSdkError("validation", "Pyth publish time moved backwards");
    }
    const cutoff = this.now() - this.historyWindowMs;
    const ordered = latest?.publishTime === parsed.publishTime
      ? [...existing.slice(0, -1), parsed]
      : [...existing, parsed];
    const next = ordered
      .filter((point) => point.publishTime * 1_000 >= cutoff)
      .slice(-this.maximumHistoryPoints);
    this.points.set(asset, next);
    this.states.set(asset, "available");
    return parsed;
  }

  seedHistorical(asset: PilotAsset, update: unknown): PricePoint {
    const parsed = parseHermesUpdate(asset, update);
    const ageMs = this.now() - parsed.publishTime * 1_000;
    if (ageMs < -this.futureToleranceMs || ageMs > this.historyWindowMs) {
      throw new StrykeSdkError("source_stale", "Historical Pyth price is outside the configured history window");
    }
    const byTime = new Map((this.points.get(asset) ?? []).map((point) => [point.publishTime, point]));
    byTime.set(parsed.publishTime, parsed);
    this.points.set(asset, [...byTime.values()].sort((a, b) => a.publishTime - b.publishTime).slice(-this.maximumHistoryPoints));
    return parsed;
  }

  current(asset: PilotAsset): PricePoint {
    const point = this.points.get(asset)?.at(-1);
    if (!point || this.now() - point.publishTime * 1_000 > this.staleAfterMs) {
      throw new StrykeSdkError(
        point ? "source_stale" : "source_unavailable",
        "Pyth price is unavailable or stale",
        true,
        { asset }
      );
    }
    return point;
  }

  history(asset: PilotAsset): readonly PricePoint[] {
    return [...(this.points.get(asset) ?? [])];
  }

  unavailable(asset: PilotAsset): void {
    this.points.delete(asset);
    this.states.set(asset, "unavailable");
  }

  reconnecting(asset: PilotAsset): void {
    this.points.delete(asset);
    this.states.set(asset, "reconnecting");
  }

  sourceState(asset: PilotAsset): PriceSourceState {
    return this.states.get(asset) ?? "unavailable";
  }
}

export const seedHermesHistory = async ({
  endpoint, asset, store, lookbackSeconds, sampleCount = 9, now = Date.now,
  request = fetch, wait = (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  maximumAttempts = 5,
}: {
  endpoint: string;
  asset: PilotAsset;
  store: PriceStore;
  lookbackSeconds: number;
  sampleCount?: number;
  now?: () => number;
  request?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  maximumAttempts?: number;
}): Promise<number> => {
  if (!Number.isSafeInteger(lookbackSeconds) || lookbackSeconds <= 0 || !Number.isSafeInteger(sampleCount) || sampleCount < 2 || sampleCount > 100 || !Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 10) {
    throw new StrykeSdkError("configuration", "Historical Pyth sampling configuration is invalid");
  }
  const endpointUrl = new URL(endpoint);
  const feedId = PYTH_FEED_IDS[asset];
  if (!feedId) {
    throw new StrykeSdkError("unsupported_asset", `No Pyth feed is configured for ${asset}`);
  }
  const end = Math.floor(now() / 1_000) - 2;
  const start = end - lookbackSeconds;
  const timestamps = Array.from({ length: sampleCount }, (_, index) => Math.round(start + (lookbackSeconds * index) / (sampleCount - 1)));
  for (const timestamp of timestamps) {
    const url = new URL(`/v2/updates/price/${timestamp}`, endpointUrl);
    url.searchParams.append("ids[]", feedId.slice(2));
    url.searchParams.set("parsed", "true");
    let response: Response | undefined;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      response = await request(url, { headers: { accept: "application/json" } });
      if (response.ok) break;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maximumAttempts) {
        throw new StrykeSdkError("source_unavailable", `Pyth history request failed (${response.status}) after ${attempt} attempt${attempt === 1 ? "" : "s"}`, retryable);
      }
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const backoffMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
        ? Math.min(retryAfterSeconds * 1_000, 30_000)
        : Math.min(1_000 * 2 ** (attempt - 1), 30_000);
      await wait(backoffMs);
    }
    if (!response?.ok) throw new StrykeSdkError("source_unavailable", "Pyth history request failed", true);
    store.seedHistorical(asset, await response.json());
  }
  return timestamps.length;
};

export const parseHermesUpdate = (asset: PilotAsset, value: unknown): PricePoint => {
  if (typeof value !== "object" || value === null) {
    throw new StrykeSdkError("validation", "Invalid Pyth update");
  }
  const parsed = (value as { parsed?: unknown }).parsed;
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new StrykeSdkError("validation", "Pyth update must contain one parsed feed");
  }
  const update = parsed[0] as {
    id?: unknown;
    price?: { price?: unknown; expo?: unknown; publish_time?: unknown };
  };
  const expectedFeed = PYTH_FEED_IDS[asset];
  if (!expectedFeed) {
    throw new StrykeSdkError("unsupported_asset", `No Pyth feed is configured for ${asset}`);
  }
  const actualFeed = typeof update.id === "string" ? `0x${update.id.replace(/^0x/, "")}` : "";
  const raw = update.price?.price;
  const expo = update.price?.expo;
  const publishTime = update.price?.publish_time;
  if (
    actualFeed.toLowerCase() !== expectedFeed.toLowerCase() ||
    typeof raw !== "string" ||
    typeof expo !== "number" ||
    !Number.isInteger(expo) ||
    typeof publishTime !== "number" ||
    !Number.isInteger(publishTime)
  ) {
    throw new StrykeSdkError("validation", "Pyth feed identity or price fields are invalid");
  }
  const price = Number(raw) * 10 ** expo;
  if (!Number.isFinite(price) || price <= 0) {
    throw new StrykeSdkError("validation", "Pyth normalized price is invalid");
  }
  return { asset, feedId: expectedFeed, price, publishTime };
};

export type PriceSubscription = { close(): void };

export const subscribeHermes = async ({
  endpoint,
  apiKey,
  assets,
  store,
  onError,
}: {
  endpoint: string;
  apiKey?: string;
  assets: readonly PilotAsset[];
  store: PriceStore;
  onError?: (error: unknown) => void;
}): Promise<PriceSubscription> => {
  const feedIds = assets.map((asset) => {
    const feedId = PYTH_FEED_IDS[asset];
    if (!feedId) {
      throw new StrykeSdkError("unsupported_asset", `No Pyth feed is configured for ${asset}`);
    }
    return feedId;
  });
  for (const asset of assets) store.reconnecting(asset);
  const client = new HermesClient(
    endpoint,
    apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}
  );
  const stream = await client.getPriceUpdatesStream(
    feedIds,
    { parsed: true, allowUnordered: false }
  );
  stream.onmessage = (event) => {
    try {
      const value = JSON.parse(event.data) as { parsed?: Array<{ id?: string }> };
      const feedId = value.parsed?.[0]?.id?.replace(/^0x/, "").toLowerCase();
      const asset = assets.find(
        (candidate) => PYTH_FEED_IDS[candidate]?.slice(2).toLowerCase() === feedId
      );
      if (!asset) throw new StrykeSdkError("validation", "Unexpected Pyth feed");
      store.ingest(asset, value);
    } catch (error) {
      onError?.(error);
    }
  };
  stream.onerror = (error) => {
    for (const asset of assets) store.unavailable(asset);
    onError?.(error);
  };
  return { close: () => stream.close() };
};
