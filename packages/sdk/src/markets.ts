import type { PilotExpiryFamily } from "./compatibility.js";
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
  asset: string;
  assetRef: string;
  tokenMint: string;
  source: "pyth_oracle";
  collateral: "SOL";
  expiryFamily: PilotExpiryFamily;
  expiryTs: number;
  strikePrice: string;
  strikePriceDecimal: number;
};

export type MarketIntervalLifecycle =
  | "upcoming"
  | "active"
  | "closing"
  | "locked"
  | "closed";

export type RollingMarketReference = {
  assetKey: string;
  expiryFamily: PilotExpiryFamily;
  intervalStartTs: number;
  intervalEndTs: number;
  policy: "stryke_open" | "polymarket" | "stryke_fallback";
  alignmentStatus: "native" | "aligned" | "degraded";
  status: "locked";
  targetValue: string;
  targetDecimals: number;
  observedAt: string;
  externalVenue?: "polymarket";
  externalMarketId?: string;
  externalSlug?: string;
  upTokenId?: string;
  downTokenId?: string;
  fallbackReason?: string;
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
  activation?: { yes: PilotActivationSide; no: PilotActivationSide };
  probability: { yesBps: number; noBps: number };
  minimumTradeCollateralUnits?: string;
  intervalStartTs: number;
  intervalLifecycle: MarketIntervalLifecycle;
  reference: RollingMarketReference;
  lifecycle: PilotLifecycleEvidence<PilotMarketLifecycleState>;
  rawStatus: string;
  generatedAt: string;
  raw: Readonly<Record<string, unknown>>;
};

export type PilotActivationSide = {
  activated: boolean;
  thresholdCollateralUnits: string;
  realPoolCollateralUnits: string;
  feeModeForNextBuy: "normal" | "activation_waived";
  feeModeForNextSell: "normal" | "activation_waived";
};

export const assertMarketTradeable = (
  market: PilotMarket,
  operation: "quote" | "prepare"
): void => {
  if (market.stale || market.pools.stale) {
    throw new StrykeSdkError("source_stale", "Pilot market data is stale", true, {
      marketId: market.marketId,
      operation,
    });
  }
  if (market.reference.status !== "locked") {
    throw new StrykeSdkError("quote_blocked", "Market reference is not locked", true, {
      marketId: market.marketId,
      operation,
    });
  }
  if (!(["active", "closing"] as MarketIntervalLifecycle[]).includes(market.intervalLifecycle)) {
    throw new StrykeSdkError("quote_blocked", "Market is outside its trading interval", false, {
      marketId: market.marketId,
      operation,
      intervalLifecycle: market.intervalLifecycle,
    });
  }
  const permitted = operation === "quote"
    ? market.tradeability.canQuote
    : market.tradeability.canPrepareTransaction;
  if (!permitted) {
    throw new StrykeSdkError("quote_blocked", `Market ${operation} is unavailable`, true, {
      marketId: market.marketId,
      operation,
      disabledReasons: market.tradeability.disabledReasons.join(","),
    });
  }
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

const safeInteger = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new StrykeSdkError("validation", `Invalid market field: ${name}`);
  }
  return value as number;
};

const normalizedDecimal = (value: string): string => {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new StrykeSdkError("validation", "Invalid market reference target");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return fraction ? `${match[1]}.${fraction}` : match[1]!;
};

const parseMarketReference = (
  value: unknown,
  identity: { expiryFamily: PilotExpiryFamily; expiryTs: number; targetValue: string }
): RollingMarketReference => {
  const row = record(value, "marketReference");
  const policy = text(row.policy, "marketReference.policy");
  const alignmentStatus = text(row.alignmentStatus, "marketReference.alignmentStatus");
  const status = text(row.status, "marketReference.status");
  const targetValue = text(row.targetValue, "marketReference.targetValue");
  const intervalStartTs = safeInteger(row.intervalStartTs, "marketReference.intervalStartTs");
  const intervalEndTs = safeInteger(row.intervalEndTs, "marketReference.intervalEndTs");
  const targetDecimals = row.targetDecimals;
  if (
    !["stryke_open", "polymarket", "stryke_fallback"].includes(policy) ||
    !["native", "aligned", "degraded"].includes(alignmentStatus) ||
    status !== "locked" ||
    !Number.isSafeInteger(targetDecimals) ||
    (targetDecimals as number) < 0 ||
    intervalEndTs !== identity.expiryTs ||
    intervalStartTs >= intervalEndTs ||
    row.expiryFamily !== identity.expiryFamily ||
    normalizedDecimal(targetValue) !== normalizedDecimal(identity.targetValue) ||
    typeof row.observedAt !== "string" ||
    !Number.isFinite(Date.parse(row.observedAt))
  ) {
    throw new StrykeSdkError("validation", "Market reference identity is inconsistent");
  }
  if (
    (alignmentStatus === "aligned" && policy !== "polymarket") ||
    (alignmentStatus === "native" && policy !== "stryke_open") ||
    (alignmentStatus === "degraded" && policy !== "stryke_fallback")
  ) {
    throw new StrykeSdkError("validation", "Market reference provenance is inconsistent");
  }
  const optionalText = (field: string) =>
    row[field] === undefined ? undefined : text(row[field], `marketReference.${field}`);
  const externalVenue = optionalText("externalVenue");
  const externalMarketId = optionalText("externalMarketId");
  const externalSlug = optionalText("externalSlug");
  const upTokenId = optionalText("upTokenId");
  const downTokenId = optionalText("downTokenId");
  const fallbackReason = optionalText("fallbackReason");
  if (externalVenue !== undefined && externalVenue !== "polymarket") {
    throw new StrykeSdkError("validation", "Unsupported market reference venue");
  }
  if (
    alignmentStatus === "aligned" &&
    (externalVenue !== "polymarket" || !externalMarketId || !upTokenId || !downTokenId)
  ) {
    throw new StrykeSdkError("validation", "Aligned market reference provenance is incomplete");
  }
  if (alignmentStatus === "degraded" && !fallbackReason) {
    throw new StrykeSdkError("validation", "Fallback market reference reason is missing");
  }
  return {
    assetKey: text(row.assetKey, "marketReference.assetKey"),
    expiryFamily: identity.expiryFamily,
    intervalStartTs,
    intervalEndTs,
    policy: policy as RollingMarketReference["policy"],
    alignmentStatus: alignmentStatus as RollingMarketReference["alignmentStatus"],
    status: "locked",
    targetValue,
    targetDecimals: targetDecimals as number,
    observedAt: row.observedAt as string,
    ...(externalVenue ? { externalVenue: "polymarket" as const } : {}),
    ...(externalMarketId ? { externalMarketId } : {}),
    ...(externalSlug ? { externalSlug } : {}),
    ...(upTokenId ? { upTokenId } : {}),
    ...(downTokenId ? { downTokenId } : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
  };
};

export const parsePilotMarket = (
  value: unknown,
  stale: boolean,
  generatedAt = new Date(0).toISOString(),
  surfaceValue?: unknown,
  supportedAssets: readonly string[] = PILOT_ASSETS
): PilotMarket => {
  const row = record(value, "market");
  const tradeability = record(row.tradeability, "tradeability");
  const collateral = record(row.collateral, "collateral");
  const asset = text(row.symbol, "symbol").toUpperCase();
  const expiryFamily = text(row.expiryFamily, "expiryFamily");
  const expiryTs = row.expiryTs;
  const status = text(row.status, "status");
  const rawStatus = text(row.rawStatus, "rawStatus");
  const intervalStartTs = safeInteger(row.intervalStartTs, "intervalStartTs");
  const intervalLifecycle = text(row.intervalLifecycle, "intervalLifecycle");
  const lifecycle = parsePilotMarketLifecycle(row.pilotLifecycle);
  const selectedMarket = row.selectedMarket === undefined
    ? record(surfaceValue, "surface")
    : record(row.selectedMarket, "selectedMarket");
  const pools = record(selectedMarket.pools, "surface.pools");
  const activation = selectedMarket.activation === undefined
    ? undefined
    : record(selectedMarket.activation, "surface.activation");
  const parseActivationSide = (side: "yes" | "no"): PilotActivationSide => {
    if (!activation) throw new StrykeSdkError("validation", "Market activation state is unavailable");
    const value = record(activation[side], `surface.activation.${side}`);
    const buyMode = text(value.feeModeForNextBuy, `surface.activation.${side}.feeModeForNextBuy`);
    const sellMode = text(value.feeModeForNextSell, `surface.activation.${side}.feeModeForNextSell`);
    if (!["normal", "activation_waived"].includes(buyMode) || !["normal", "activation_waived"].includes(sellMode)) {
      throw new StrykeSdkError("validation", `Invalid activation fee mode: ${side}`);
    }
    return {
      activated: boolean(value.activated, `surface.activation.${side}.activated`),
      thresholdCollateralUnits: amount(value.thresholdCollateralUnits, `surface.activation.${side}.thresholdCollateralUnits`),
      realPoolCollateralUnits: amount(value.realPoolCollateralUnits, `surface.activation.${side}.realPoolCollateralUnits`),
      feeModeForNextBuy: buyMode as PilotActivationSide["feeModeForNextBuy"],
      feeModeForNextSell: sellMode as PilotActivationSide["feeModeForNextSell"],
    };
  };
  const odds = record(selectedMarket.odds, "surface.odds");
  const tradeBounds = selectedMarket.tradeBounds === undefined
    ? undefined
    : record(selectedMarket.tradeBounds, "surface.tradeBounds");
  const disabledReasons = tradeability.disabledReasons;
  const strikePrice = text(row.targetValue, "targetValue");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(strikePrice)) {
    throw new StrykeSdkError("validation", "Invalid Pyth strike price");
  }
  const strikePriceDecimal = Number(strikePrice);
  if (!Number.isFinite(strikePriceDecimal) || strikePriceDecimal <= 0) {
    throw new StrykeSdkError("validation", "Invalid Pyth strike price");
  }
  if (!supportedAssets.includes(asset)) {
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
  if (
    !["upcoming", "active", "closing", "locked", "closed"].includes(
      intervalLifecycle
    ) ||
    intervalStartTs >= (expiryTs as number)
  ) {
    throw new StrykeSdkError("validation", "Invalid market interval lifecycle");
  }
  const reference = parseMarketReference(row.marketReference, {
    expiryFamily: expiryFamily as PilotExpiryFamily,
    expiryTs: expiryTs as number,
    targetValue: strikePrice,
  });
  if (
    (["upcoming", "locked", "closed"] as MarketIntervalLifecycle[]).includes(
      intervalLifecycle as MarketIntervalLifecycle
    ) &&
    (boolean(tradeability.canQuote, "tradeability.canQuote") ||
      boolean(tradeability.canPrepareTransaction, "tradeability.canPrepareTransaction"))
  ) {
    throw new StrykeSdkError("validation", "Non-tradeable interval exposes write capabilities");
  }
  const allowedStatuses = ["open", "initializable", "paused", "expired", "settled", "unavailable"];
  if (!allowedStatuses.includes(status)) {
    throw new StrykeSdkError("validation", `Unsupported market status: ${status}`);
  }

  return {
    marketId: text(row.marketId, "marketId"),
    asset,
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
    ...(activation ? { activation: { yes: parseActivationSide("yes"), no: parseActivationSide("no") } } : {}),
    probability: {
      yesBps: bps(odds.yesBps, "surface.odds.yesBps"),
      noBps: bps(odds.noBps, "surface.odds.noBps"),
    },
    ...(tradeBounds ? {
      minimumTradeCollateralUnits: amount(
        tradeBounds.minimumTradeCollateralUnits,
        "surface.tradeBounds.minimumTradeCollateralUnits"
      ),
    } : {}),
    intervalStartTs,
    intervalLifecycle: intervalLifecycle as MarketIntervalLifecycle,
    reference,
    lifecycle,
    rawStatus,
    generatedAt: text(generatedAt, "metadata.generatedAt"),
    raw: row,
  };
};

export class MarketsClient {
  constructor(private readonly client: StrykeClient) {}

  async list(asset: string, expiryFamily: PilotExpiryFamily): Promise<PilotMarket[]> {
    const configuredAssets = this.client.capabilities?.assets?.map((row) => row.symbol) ?? PILOT_ASSETS;
    if (!configuredAssets.includes(asset)) {
      throw new StrykeSdkError("unsupported_asset", `Unsupported pilot asset: ${asset}`);
    }
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
    const referencedRows = response.markets.filter((row) => {
      const candidate = record(row, "market");
      return candidate.marketReference !== undefined;
    });
    return Promise.all(referencedRows.map(async (row) => {
      const candidate = record(row, "market");
      if (candidate.selectedMarket !== undefined) {
        return parsePilotMarket(row, response.metadata.stale, response.metadata.generatedAt, undefined, configuredAssets);
      }
      const links = record(candidate.links, "links");
      const surfacePath = text(links.surface, "links.surface");
      if (!surfacePath.startsWith("/v1/")) {
        throw new StrykeSdkError("validation", "Market surface link is outside API v1");
      }
      const detail = await this.client.requestJson<{ surface: unknown; metadata: { stale?: boolean } }>(surfacePath as `/v1/${string}`);
      return parsePilotMarket(row, response.metadata.stale || detail.metadata.stale === true, response.metadata.generatedAt, detail.surface, configuredAssets);
    }));
  }

  async byIdentity(
    asset: string,
    identity: { expiryFamily: PilotExpiryFamily; expiryTs: number; targetValue: string }
  ): Promise<PilotMarket> {
    const configured = this.client.capabilities?.assets?.find((row) => row.symbol === asset);
    if (!configured) {
      throw new StrykeSdkError("unsupported_asset", `Unsupported pilot asset: ${asset}`);
    }
    const marketId = [
      "pyth_oracle",
      configured.pythFeedId,
      "SOL",
      identity.expiryFamily,
      identity.expiryTs,
      identity.targetValue,
    ].join(":");
    const response = await this.client.requestJson<{
      market: unknown;
      surface: unknown;
      metadata: { stale?: boolean; generatedAt?: string };
    }>(`/v1/markets/${encodeURIComponent(marketId)}/surface` as `/v1/${string}`);
    const generatedAt = response.metadata.generatedAt ?? new Date(0).toISOString();
    return parsePilotMarket(
      response.market,
      response.metadata.stale === true,
      generatedAt,
      response.surface,
      this.client.capabilities.assets.map((row) => row.symbol)
    );
  }

  async current(
    asset: string,
    expiryFamily: PilotExpiryFamily,
    _referencePrice?: number
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
    const referenced = earliest.filter((market) => market.reference.status === "locked");
    const referencePreferred = referenced.length > 0 ? referenced : earliest;
    const materialized = referencePreferred.filter((market) => isAddress(market.tokenMint));
    const preferred = materialized.length > 0 ? materialized : referencePreferred;
    const tradeable = preferred.filter((market) => market.tradeability.canQuote && market.tradeability.canPrepareTransaction);
    if (tradeable.length === 1) return tradeable[0]!;
    if (tradeable.length === 0 && preferred.length > 1) {
      throw new StrykeSdkError("source_unavailable", "Requested pilot market has no unique tradeable current market", true, { asset, expiryFamily });
    }
    if (preferred.length !== 1) {
      throw new StrykeSdkError("validation", "Requested pilot market is ambiguous");
    }
    return preferred[0]!;
  }
}
