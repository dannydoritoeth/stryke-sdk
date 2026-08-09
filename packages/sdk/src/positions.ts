import type { StrykeClient } from "./client.js";
import { StrykeSdkError } from "./errors.js";
import {
  parsePilotPositionLifecycle,
  type PilotLifecycleEvidence,
  type PilotPositionLifecycleState,
} from "./lifecycle.js";
import type { PilotMarket } from "./markets.js";
import { PILOT_ASSETS, type PilotAsset } from "./compatibility.js";
import type { PositionValuation } from "./quotes.js";

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
  economicVersion?: number;
  valuation?: PositionValuation;
  poolState?: PilotPositionPoolState;
  claimableAmount?: string;
  refundableAmount?: string;
  actionDeadline?: string;
  cleanup?: PilotPositionCleanup;
  lifecycle: PilotLifecycleEvidence<PilotPositionLifecycleState>;
  raw: Readonly<Record<string, unknown>>;
};

export type PilotPositionCleanup = {
  rentRecipient: string;
  selfCloseAvailable: boolean;
  action: "close_position";
  cleanupEligibleAt: string;
  marketSettlementStatus: "settled" | "not_settled";
  blockedReason?: string;
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

const signedAmount = (value: unknown, field: string): string => {
  const parsed = text(value, field);
  if (!/^-?\d+$/.test(parsed)) {
    throw new StrykeSdkError("api_response", `Invalid position amount: ${field}`);
  }
  return parsed;
};

const optionalSafeInteger = (
  value: unknown,
  field: string
): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new StrykeSdkError("api_response", `Invalid position field: ${field}`);
  }
  return value;
};

const valuation = (value: unknown): PositionValuation | undefined => {
  if (value === undefined) return undefined;
  const row = record(value, "valuation");
  if (row.stale !== false) {
    throw new StrykeSdkError("source_stale", "Position valuation is stale or unavailable");
  }
  const generatedAt = text(row.generatedAt, "valuation.generatedAt");
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new StrykeSdkError("api_response", "Position valuation timestamp is invalid");
  }
  const currentPnlBps = optionalSafeInteger(
    row.currentPnlBps,
    "valuation.currentPnlBps"
  );
  const profitIfWinsBps = optionalSafeInteger(
    row.profitIfWinsBps,
    "valuation.profitIfWinsBps"
  );
  return {
    costBasisCollateralUnits: amount(
      row.costBasisCollateralUnits,
      "valuation.costBasisCollateralUnits"
    ),
    currentValueCollateralUnits: amount(
      row.currentValueCollateralUnits,
      "valuation.currentValueCollateralUnits"
    ),
    currentPnlCollateralUnits: signedAmount(
      row.currentPnlCollateralUnits,
      "valuation.currentPnlCollateralUnits"
    ),
    ...(currentPnlBps === undefined ? {} : { currentPnlBps }),
    winningPayoutCollateralUnits: amount(
      row.winningPayoutCollateralUnits,
      "valuation.winningPayoutCollateralUnits"
    ),
    profitIfWinsCollateralUnits: signedAmount(
      row.profitIfWinsCollateralUnits,
      "valuation.profitIfWinsCollateralUnits"
    ),
    ...(profitIfWinsBps === undefined ? {} : { profitIfWinsBps }),
    marketStateVersion: text(row.marketStateVersion, "valuation.marketStateVersion"),
    generatedAt,
    stale: false,
  };
};

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
  const economicVersion =
    row.economicVersion === undefined ? undefined : Number(row.economicVersion);
  if (
    economicVersion !== undefined &&
    (!Number.isInteger(economicVersion) || economicVersion !== 2)
  ) {
    throw new StrykeSdkError("compatibility", "Position economic version is unsupported");
  }
  const parsedValuation = valuation(row.valuation);
  let cleanup: PilotPositionCleanup | undefined;
  if (row.cleanup !== undefined) {
    const cleanupRow = record(row.cleanup, "cleanup");
    const staleCleanup = record(cleanupRow.staleCleanup, "cleanup.staleCleanup");
    const cleanupEligibleAt = text(staleCleanup.cleanupEligibleAt, "cleanup.staleCleanup.cleanupEligibleAt");
    const marketSettlementStatus = forceClose?.status;
    if (
      typeof cleanupRow.selfCloseAvailable !== "boolean" ||
      staleCleanup.action !== "close_position" ||
      !Number.isFinite(Date.parse(cleanupEligibleAt)) ||
      (marketSettlementStatus !== "settled" && marketSettlementStatus !== "not_settled")
    ) throw new StrykeSdkError("api_response", "Position cleanup metadata is invalid");
    cleanup = {
      rentRecipient: text(cleanupRow.rentRecipient, "cleanup.rentRecipient"),
      selfCloseAvailable: cleanupRow.selfCloseAvailable,
      action: "close_position",
      cleanupEligibleAt,
      marketSettlementStatus,
      ...(typeof forceClose?.blockedReason === "string"
        ? { blockedReason: forceClose.blockedReason }
        : {}),
    };
  }
  if (
    (lifecycle.state === "open_position" || lifecycle.state === "sellable") &&
    (economicVersion !== 2 || parsedValuation === undefined)
  ) {
    throw new StrykeSdkError(
      "source_stale",
      "Active position is awaiting authoritative V2 valuation",
      true
    );
  }
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
    ...(economicVersion === undefined ? {} : { economicVersion }),
    ...(parsedValuation === undefined ? {} : { valuation: parsedValuation }),
    ...(parsedPoolState === undefined ? {} : { poolState: parsedPoolState }),
    ...(claimableAmount === undefined ? {} : { claimableAmount }),
    ...(refundableAmount === undefined ? {} : { refundableAmount }),
    ...(typeof actionDeadline === "string" ? { actionDeadline } : {}),
    ...(cleanup === undefined ? {} : { cleanup }),
    lifecycle,
    raw: row,
  };
};

export const positionCleanupPending = (position: PilotPosition): boolean =>
  position.cleanup?.selfCloseAvailable === true &&
  position.cleanup.rentRecipient === position.owner &&
  BigInt(position.yesShares) === 0n &&
  BigInt(position.noShares) === 0n;

export const positionCleanupAvailable = (
  position: PilotPosition,
  now = Date.now()
): boolean =>
  positionCleanupPending(position) &&
  position.cleanup!.marketSettlementStatus === "settled" &&
  now >= Date.parse(position.cleanup!.cleanupEligibleAt);

export const positionIfWinPayout = (
  position: PilotPosition,
  exposure: PilotPositionSideExposure
): string | undefined => {
  void exposure;
  return position.valuation?.winningPayoutCollateralUnits;
};

export type PilotPositionSideExposure = {
  side: "yes" | "no";
  shares: string;
  costBasisCollateralUnits?: string;
  currentValueCollateralUnits?: string;
  winningPayoutCollateralUnits?: string;
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
      ...(position.valuation?.currentValueCollateralUnits === undefined
        ? {}
        : { currentValueCollateralUnits: position.valuation.currentValueCollateralUnits }),
      ...(position.valuation?.winningPayoutCollateralUnits === undefined
        ? {}
        : { winningPayoutCollateralUnits: position.valuation.winningPayoutCollateralUnits }),
    });
  }
  if (BigInt(position.noShares) > 0n) {
    exposures.push({
      side: "no",
      shares: position.noShares,
      ...(position.noCostBasisCollateralUnits === undefined
        ? {}
        : { costBasisCollateralUnits: position.noCostBasisCollateralUnits }),
      ...(position.valuation?.currentValueCollateralUnits === undefined
        ? {}
        : { currentValueCollateralUnits: position.valuation.currentValueCollateralUnits }),
      ...(position.valuation?.winningPayoutCollateralUnits === undefined
        ? {}
        : { winningPayoutCollateralUnits: position.valuation.winningPayoutCollateralUnits }),
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
