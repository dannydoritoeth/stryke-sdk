import { StrykeSdkError } from "./errors.js";

export const PILOT_MARKET_LIFECYCLE_STATES = [
  "upcoming",
  "open",
  "trading_closed",
  "resolvable",
  "resolved_yes",
  "resolved_no",
  "refundable_underfunded",
  "refundable_zero_winner",
] as const;

export const PILOT_POSITION_LIFECYCLE_STATES = [
  "pending_confirmation",
  "open_position",
  "sellable",
  "awaiting_resolution",
  "claimable",
  "refundable",
  "lost",
  "claimed",
  "refunded",
  "sold",
  "expired_unclaimed",
] as const;

export type PilotMarketLifecycleState =
  (typeof PILOT_MARKET_LIFECYCLE_STATES)[number];
export type PilotPositionLifecycleState =
  (typeof PILOT_POSITION_LIFECYCLE_STATES)[number];

export type PilotLifecycleEvidence<State extends string> = {
  schemaVersion: "stryke.pilotLifecycle.v1";
  state: State;
  rawStatus: string;
  rawReason: string;
  observedAt: string;
  observedSlot?: number;
};

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StrykeSdkError("api_response", "Lifecycle evidence is invalid");
  }
  return value as Record<string, unknown>;
};

const parseLifecycle = <State extends string>(
  value: unknown,
  states: readonly State[]
): PilotLifecycleEvidence<State> => {
  const row = record(value);
  if (
    row.schemaVersion !== "stryke.pilotLifecycle.v1" ||
    typeof row.state !== "string" ||
    !states.includes(row.state as State) ||
    typeof row.rawStatus !== "string" ||
    row.rawStatus.length === 0 ||
    typeof row.rawReason !== "string" ||
    row.rawReason.length === 0 ||
    typeof row.observedAt !== "string" ||
    !Number.isFinite(Date.parse(row.observedAt)) ||
    (row.observedSlot !== undefined &&
      (!Number.isSafeInteger(row.observedSlot) || (row.observedSlot as number) < 0))
  ) {
    throw new StrykeSdkError(
      "api_response",
      "Lifecycle evidence contract is unsupported"
    );
  }
  return {
    schemaVersion: "stryke.pilotLifecycle.v1",
    state: row.state as State,
    rawStatus: row.rawStatus,
    rawReason: row.rawReason,
    observedAt: row.observedAt,
    ...(row.observedSlot === undefined
      ? {}
      : { observedSlot: row.observedSlot as number }),
  };
};

export const parsePilotMarketLifecycle = (value: unknown) =>
  parseLifecycle(value, PILOT_MARKET_LIFECYCLE_STATES);

export const parsePilotPositionLifecycle = (value: unknown) =>
  parseLifecycle(value, PILOT_POSITION_LIFECYCLE_STATES);
