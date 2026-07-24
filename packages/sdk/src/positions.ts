import type { StrykeClient } from "./client.js";
import { StrykeSdkError } from "./errors.js";
import {
  parsePilotPositionLifecycle,
  type PilotLifecycleEvidence,
  type PilotPositionLifecycleState,
} from "./lifecycle.js";
import type { PilotMarket } from "./markets.js";
import { PILOT_ASSETS, type PilotAsset } from "./compatibility.js";

export type PositionTerminalAction = "claim" | "refund";

export type PilotPosition = {
  positionId: string;
  owner: string;
  asset?: PilotAsset;
  market: Readonly<Record<string, unknown>>;
  marketSeries?: string;
  strikeMarket?: string;
  yesShares: string;
  noShares: string;
  yesCostBasisCollateralUnits?: string;
  noCostBasisCollateralUnits?: string;
  poolState?: PilotPositionPoolState;
  claimableAmount?: string;
  refundableAmount?: string;
  actionDeadline?: string;
  lifecycle: PilotLifecycleEvidence<PilotPositionLifecycleState>;
  raw: Readonly<Record<string, unknown>>;
};

export type PilotPositionPoolState = {
  realYesPoolCollateralUnits: string;
  realNoPoolCollateralUnits: string;
  totalYesShares: string;
  totalNoShares: string;
};

type PortfolioResponse = {
  owner: string;
  positions: unknown[];
  metadata: { stale: boolean; generatedAt: string };
};

const record = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StrykeSdkError("api_response", `Invalid position field: ${field}`);
  }
  return value as Record<string, unknown>;
};

const text = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new StrykeSdkError("api_response", `Invalid position field: ${field}`);
  }
  return value;
};

const amount = (value: unknown, field: string): string => {
  const parsed = text(value, field);
  if (!/^\d+$/.test(parsed)) {
    throw new StrykeSdkError("api_response", `Invalid position amount: ${field}`);
  }
  return parsed;
};

const optionalAmount = (value: unknown, field: string): string | undefined =>
  value === undefined ? undefined : amount(value, field);

const poolState = (value: unknown): PilotPositionPoolState | undefined => {
  if (value === undefined) return undefined;
  const row = record(value, "poolState");
  return {
    realYesPoolCollateralUnits: amount(row.realYesPoolCollateralUnits, "poolState.realYesPoolCollateralUnits"),
    realNoPoolCollateralUnits: amount(row.realNoPoolCollateralUnits, "poolState.realNoPoolCollateralUnits"),
    totalYesShares: amount(row.totalYesShares, "poolState.totalYesShares"),
    totalNoShares: amount(row.totalNoShares, "poolState.totalNoShares"),
  };
};

const positionId = (row: Record<string, unknown>): string =>
  [
    text(row.tokenMint, "tokenMint"),
    text(row.source, "source"),
    text(record(row.collateral, "collateral").mint, "collateral.mint"),
    text(row.expiryFamily, "expiryFamily"),
    String(row.expiryTs),
    text(row.targetValue, "targetValue"),
  ].join(":");

export const parsePilotPosition = (value: unknown): PilotPosition => {
  const row = record(value, "position");
  const forceClose =
    row.forceClose === undefined ? undefined : record(row.forceClose, "forceClose");
  const actionDeadline = forceClose?.expiryAt;
  if (
    typeof row.expiryTs !== "number" ||
    !Number.isSafeInteger(row.expiryTs) ||
    (actionDeadline !== undefined &&
      (typeof actionDeadline !== "string" || !Number.isFinite(Date.parse(actionDeadline))))
  ) {
    throw new StrykeSdkError("api_response", "Position identity or deadline is invalid");
  }
  const lifecycle = parsePilotPositionLifecycle(row.pilotLifecycle);
  const claimableAmount = optionalAmount(row.claimableAmount, "claimableAmount");
  const refundableAmount = optionalAmount(
    row.refundableAmount,
    "refundableAmount"
  );
  const yesCostBasisCollateralUnits = optionalAmount(
    row.yesCostBasisCollateralUnits,
    "yesCostBasisCollateralUnits"
  );
  const noCostBasisCollateralUnits = optionalAmount(
    row.noCostBasisCollateralUnits,
    "noCostBasisCollateralUnits"
  );
  const parsedPoolState = poolState(row.poolState);
  const tokenSymbol = typeof row.tokenSymbol === "string" ? row.tokenSymbol.toUpperCase() : undefined;
  if (tokenSymbol !== undefined && !(PILOT_ASSETS as readonly string[]).includes(tokenSymbol)) {
    throw new StrykeSdkError("unsupported_asset", `Unsupported position asset: ${tokenSymbol}`);
  }
  return {
    positionId: positionId(row),
    owner: text(row.owner, "owner"),
    ...(tokenSymbol === undefined ? {} : { asset: tokenSymbol as PilotAsset }),
    market: {
      tokenMint: row.tokenMint,
      source: row.source,
      collateral: row.collateral,
      expiryFamily: row.expiryFamily,
      expiryTs: row.expiryTs,
      targetValue: row.targetValue,
    },
    ...(typeof row.marketSeries === "string" ? { marketSeries: row.marketSeries } : {}),
    ...(typeof row.strikeMarket === "string" ? { strikeMarket: row.strikeMarket } : {}),
    yesShares: amount(row.yesShares, "yesShares"),
    noShares: amount(row.noShares, "noShares"),
    ...(yesCostBasisCollateralUnits === undefined ? {} : { yesCostBasisCollateralUnits }),
    ...(noCostBasisCollateralUnits === undefined ? {} : { noCostBasisCollateralUnits }),
    ...(parsedPoolState === undefined ? {} : { poolState: parsedPoolState }),
    ...(claimableAmount === undefined ? {} : { claimableAmount }),
    ...(refundableAmount === undefined ? {} : { refundableAmount }),
    ...(typeof actionDeadline === "string" ? { actionDeadline } : {}),
    lifecycle,
    raw: row,
  };
};

export const positionIfWinPayout = (
  position: PilotPosition,
  exposure: PilotPositionSideExposure
): string | undefined => {
  const pool = position.poolState;
  if (!pool) return undefined;
  const totalShares = BigInt(exposure.side === "yes" ? pool.totalYesShares : pool.totalNoShares);
  if (totalShares <= 0n) return undefined;
  const totalPool = BigInt(pool.realYesPoolCollateralUnits) + BigInt(pool.realNoPoolCollateralUnits);
  return ((totalPool * BigInt(exposure.shares)) / totalShares).toString();
};

export type PilotPositionSideExposure = {
  side: "yes" | "no";
  shares: string;
  costBasisCollateralUnits?: string;
};

export const positionSideExposures = (
  position: PilotPosition
): PilotPositionSideExposure[] => {
  const exposures: PilotPositionSideExposure[] = [];
  if (BigInt(position.yesShares) > 0n) {
    exposures.push({
      side: "yes",
      shares: position.yesShares,
      ...(position.yesCostBasisCollateralUnits === undefined
        ? {}
        : { costBasisCollateralUnits: position.yesCostBasisCollateralUnits }),
    });
  }
  if (BigInt(position.noShares) > 0n) {
    exposures.push({
      side: "no",
      shares: position.noShares,
      ...(position.noCostBasisCollateralUnits === undefined
        ? {}
        : { costBasisCollateralUnits: position.noCostBasisCollateralUnits }),
    });
  }
  return exposures;
};

const marketMatches = (position: PilotPosition, market: PilotMarket): boolean => {
  const identity = position.market;
  const collateral = identity.collateral as Record<string, unknown> | undefined;
  const expectedCollateral = market.raw.collateral as
    | Record<string, unknown>
    | undefined;
  return (
    identity.tokenMint === market.tokenMint &&
    identity.source === market.source &&
    collateral?.mint === expectedCollateral?.mint &&
    identity.expiryFamily === market.expiryFamily &&
    identity.expiryTs === market.expiryTs &&
    identity.targetValue === market.strikePrice
  );
};

export const terminalActionFor = (
  position: PilotPosition,
  now = Date.now()
): PositionTerminalAction => {
  if (!position.actionDeadline || now >= Date.parse(position.actionDeadline)) {
    throw new StrykeSdkError(
      "position_state",
      "Position claim or refund deadline is unavailable or expired"
    );
  }
  if (
    position.lifecycle.state === "claimable" &&
    BigInt(position.claimableAmount ?? "0") > 0n
  ) {
    return "claim";
  }
  if (
    position.lifecycle.state === "refundable" &&
    BigInt(position.refundableAmount ?? "0") > 0n &&
    (position.lifecycle.rawReason.includes("underfunded") ||
      position.lifecycle.rawReason.includes("zero_winner"))
  ) {
    return "refund";
  }
  throw new StrykeSdkError("position_state", "Position is not actionable");
};

export class PositionsClient {
  constructor(private readonly client: StrykeClient) {}

  async list(owner: string): Promise<PilotPosition[]> {
    const response = await this.client.requestJson<PortfolioResponse>(
      `/v1/portfolio/${encodeURIComponent(owner)}`
    );
    if (
      response.owner !== owner ||
      response.metadata.stale ||
      !Array.isArray(response.positions)
    ) {
      throw new StrykeSdkError("source_stale", "Portfolio response is stale or mismatched");
    }
    const positions = response.positions.map(parsePilotPosition);
    if (positions.some((position) => position.owner !== owner)) {
      throw new StrykeSdkError("intent_mismatch", "Position owner does not match request");
    }
    return positions;
  }

  async forMarket(owner: string, market: PilotMarket): Promise<PilotPosition> {
    const matches = (await this.list(owner)).filter((position) =>
      marketMatches(position, market)
    );
    if (matches.length !== 1) {
      throw new StrykeSdkError(
        "position_state",
        matches.length === 0 ? "Position was not found" : "Position identity is ambiguous"
      );
    }
    return matches[0]!;
  }
}
