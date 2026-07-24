import type { PilotAsset, PilotExpiryFamily } from "./compatibility.js";
import { isAddress } from "@solana/kit";
import { PILOT_ASSETS, PILOT_EXPIRY_FAMILIES } from "./compatibility.js";
import type { StrykeClient } from "./client.js";
import { StrykeSdkError } from "./errors.js";
import {
  parsePilotMarketLifecycle,
  type PilotLifecycleEvidence,
  type PilotMarketLifecycleState,
} from "./lifecycle.js";

export type CanonicalMarketIdentity = {
  marketId: string;
  asset: PilotAsset;
  assetRef: string;
  tokenMint: string;
  source: "pyth_oracle";
  collateral: "SOL";
  expiryFamily: PilotExpiryFamily;
  expiryTs: number;
  strikePrice: string;
  strikePriceDecimal: number;
};

export type PilotMarket = CanonicalMarketIdentity & {
  status: "open" | "initializable" | "paused" | "expired" | "settled" | "unavailable";
  tradeability: {
    canQuote: boolean;
    canPrepareTransaction: boolean;
    disabledReasons: readonly string[];
  };
  stale: boolean;
  pools: { yes: string; no: string; stale: boolean };
  probability: { yesBps: number; noBps: number };
  lifecycle: PilotLifecycleEvidence<PilotMarketLifecycleState>;
  rawStatus: string;
  generatedAt: string;
  raw: Readonly<Record<string, unknown>>;
};

type MarketsResponse = {
  markets: unknown[];
  metadata: { contractVersion: string; generatedAt: string; stale: boolean };
};

const record = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StrykeSdkError("validation", `Invalid market field: ${name}`);
  }
  return value as Record<string, unknown>;
};

const text = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new StrykeSdkError("validation", `Invalid market field: ${name}`);
  }
  return value;
};

const boolean = (value: unknown, name: string): boolean => {
  if (typeof value !== "boolean") {
    throw new StrykeSdkError("validation", `Invalid market field: ${name}`);
  }
  return value;
};

const amount = (value: unknown, name: string): string => {
  const parsed = text(value, name);
  if (!/^\d+$/.test(parsed)) throw new StrykeSdkError("validation", `Invalid market amount: ${name}`);
  return parsed;
};

const bps = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
    throw new StrykeSdkError("validation", `Invalid market probability: ${name}`);
  }
  return value as number;
};

export const parsePilotMarket = (
  value: unknown,
  stale: boolean,
  generatedAt = new Date(0).toISOString(),
  surfaceValue?: unknown
): PilotMarket => {
  const row = record(value, "market");
  const tradeability = record(row.tradeability, "tradeability");
  const collateral = record(row.collateral, "collateral");
  const asset = text(row.symbol, "symbol").toUpperCase();
  const expiryFamily = text(row.expiryFamily, "expiryFamily");
  const expiryTs = row.expiryTs;
  const status = text(row.status, "status");
  const rawStatus = text(row.rawStatus, "rawStatus");
  const lifecycle = parsePilotMarketLifecycle(row.pilotLifecycle);
  const selectedMarket = row.selectedMarket === undefined
    ? record(surfaceValue, "surface")
    : record(row.selectedMarket, "selectedMarket");
  const pools = record(selectedMarket.pools, "surface.pools");
  const odds = record(selectedMarket.odds, "surface.odds");
  const disabledReasons = tradeability.disabledReasons;
  const strikePrice = text(row.targetValue, "targetValue");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(strikePrice)) {
    throw new StrykeSdkError("validation", "Invalid Pyth strike price");
  }
  const strikePriceDecimal = Number(strikePrice);
  if (!Number.isFinite(strikePriceDecimal) || strikePriceDecimal <= 0) {
    throw new StrykeSdkError("validation", "Invalid Pyth strike price");
  }
  if (!(PILOT_ASSETS as readonly string[]).includes(asset)) {
    throw new StrykeSdkError("unsupported_asset", `Unsupported pilot asset: ${asset}`);
  }
  if (!(PILOT_EXPIRY_FAMILIES as readonly string[]).includes(expiryFamily)) {
    throw new StrykeSdkError(
      "unsupported_expiry",
      `Unsupported pilot expiry: ${expiryFamily}`
    );
  }
  if (row.source !== "pyth_oracle" || collateral.symbol !== "SOL") {
    throw new StrykeSdkError("validation", "Pilot market source or collateral mismatch");
  }
  if (!Number.isSafeInteger(expiryTs) || !Array.isArray(disabledReasons)) {
    throw new StrykeSdkError("validation", "Invalid market expiry or disabled reasons");
  }
  const allowedStatuses = ["open", "initializable", "paused", "expired", "settled", "unavailable"];
  if (!allowedStatuses.includes(status)) {
    throw new StrykeSdkError("validation", `Unsupported market status: ${status}`);
  }

  return {
    marketId: text(row.marketId, "marketId"),
    asset: asset as PilotAsset,
    assetRef: text(row.assetRef, "assetRef"),
    tokenMint: text(row.tokenMint ?? row.assetRef, "tokenMint"),
    source: "pyth_oracle",
    collateral: "SOL",
    expiryFamily: expiryFamily as PilotExpiryFamily,
    expiryTs: expiryTs as number,
    strikePrice,
    strikePriceDecimal,
    status: status as PilotMarket["status"],
    tradeability: {
      canQuote: boolean(tradeability.canQuote, "tradeability.canQuote"),
      canPrepareTransaction: boolean(
        tradeability.canPrepareTransaction,
        "tradeability.canPrepareTransaction"
      ),
      disabledReasons: disabledReasons.map((reason, index) =>
        text(reason, `tradeability.disabledReasons[${index}]`)
      ),
    },
    stale,
    pools: {
      yes: text(pools.yesPool, "surface.pools.yesPool"),
      no: text(pools.noPool, "surface.pools.noPool"),
      stale: boolean(pools.stale, "surface.pools.stale"),
    },
    probability: {
      yesBps: bps(odds.yesBps, "surface.odds.yesBps"),
      noBps: bps(odds.noBps, "surface.odds.noBps"),
    },
    lifecycle,
    rawStatus,
    generatedAt: text(generatedAt, "metadata.generatedAt"),
    raw: row,
  };
};

export class MarketsClient {
  constructor(private readonly client: StrykeClient) {}

  async list(asset: PilotAsset, expiryFamily: PilotExpiryFamily): Promise<PilotMarket[]> {
    const query = new URLSearchParams({
      symbol: asset,
      sourceFamily: "pyth",
      collateral: "SOL",
      expiryFamily,
      limit: "20",
    });
    const response = await this.client.requestJson<MarketsResponse>(
      `/v1/markets?${query.toString()}`
    );
    if (
      response.metadata.contractVersion !== "stryke.botMarket.v1" ||
      !Array.isArray(response.markets)
    ) {
      throw new StrykeSdkError("compatibility", "Unsupported market response contract");
    }
    if (!Number.isFinite(Date.parse(response.metadata.generatedAt))) {
      throw new StrykeSdkError("api_response", "Market response timestamp is invalid");
    }
    return Promise.all(response.markets.map(async (row) => {
      const candidate = record(row, "market");
      if (candidate.selectedMarket !== undefined) {
        return parsePilotMarket(row, response.metadata.stale, response.metadata.generatedAt);
      }
      const links = record(candidate.links, "links");
      const surfacePath = text(links.surface, "links.surface");
      if (!surfacePath.startsWith("/v1/")) {
        throw new StrykeSdkError("validation", "Market surface link is outside API v1");
      }
      const detail = await this.client.requestJson<{ surface: unknown; metadata: { stale?: boolean } }>(surfacePath as `/v1/${string}`);
      return parsePilotMarket(row, response.metadata.stale || detail.metadata.stale === true, response.metadata.generatedAt, detail.surface);
    }));
  }

  async current(
    asset: PilotAsset,
    expiryFamily: PilotExpiryFamily,
    referencePrice?: number
  ): Promise<PilotMarket> {
    const listed = await this.list(asset, expiryFamily);
    if (listed.some((market) => market.stale)) {
      throw new StrykeSdkError(
        "source_stale",
        "Pilot market data is stale",
        true,
        { asset, expiryFamily }
      );
    }
    const eligible = listed
      .filter((market) => market.lifecycle.state === "open" || market.lifecycle.state === "upcoming")
      .sort((a, b) => a.expiryTs - b.expiryTs);
    if (eligible.length === 0) {
      throw new StrykeSdkError(
        "source_unavailable",
        "Requested pilot market is unavailable",
        true,
        { asset, expiryFamily }
      );
    }
    const earliest = eligible.filter((market) => market.expiryTs === eligible[0]!.expiryTs);
    const materialized = earliest.filter((market) => isAddress(market.tokenMint));
    const preferred = materialized.length > 0 ? materialized : earliest;
    const tradeable = preferred.filter((market) => market.tradeability.canQuote && market.tradeability.canPrepareTransaction);
    if (tradeable.length === 1) return tradeable[0]!;
    if (
      tradeable.length === 0 &&
      expiryFamily === "hourly" &&
      preferred.length > 1 &&
      preferred.every((market) => market.status === "initializable" || market.status === "open") &&
      referencePrice !== undefined &&
      Number.isFinite(referencePrice) &&
      referencePrice > 0
    ) {
      const byTarget = new Map<string, PilotMarket>();
      for (const market of preferred) {
        const existing = byTarget.get(market.strikePrice);
        if (!existing || (existing.status === "initializable" && market.status === "open")) {
          byTarget.set(market.strikePrice, market);
        }
      }
      const byDistance = [...byTarget.values()]
        .map((market) => ({ market, distance: Math.abs(market.strikePriceDecimal - referencePrice) }))
        .sort((left, right) => left.distance - right.distance);
      if (byDistance.length > 1 && byDistance[0]!.distance === byDistance[1]!.distance) {
        throw new StrykeSdkError("validation", "Requested pilot market is ambiguous");
      }
      return byDistance[0]!.market;
    }
    if (tradeable.length === 0 && preferred.length > 1) {
      throw new StrykeSdkError("source_unavailable", "Requested pilot market has no unique tradeable current market", true, { asset, expiryFamily });
    }
    if (preferred.length !== 1) {
      throw new StrykeSdkError("validation", "Requested pilot market is ambiguous");
    }
    return preferred[0]!;
  }
}
