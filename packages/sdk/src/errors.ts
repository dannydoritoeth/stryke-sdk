export const STRYKE_SDK_ERROR_CODES = [
  "configuration",
  "compatibility",
  "validation",
  "unsupported_asset",
  "unsupported_expiry",
  "api_response",
  "source_unavailable",
  "source_stale",
  "quote_blocked",
  "intent_mismatch",
  "wallet_rejected",
  "simulation_failed",
  "submission_failed",
  "confirmation_timeout",
  "confirmation_unknown",
  "blockhash_expired",
  "duplicate_action",
  "position_state",
  "claim_state",
] as const;

export type StrykeSdkErrorCode = (typeof STRYKE_SDK_ERROR_CODES)[number];

export type StrykeSdkErrorContextValue = string | number | boolean;
export type StrykeSdkErrorContext = Readonly<
  Record<string, StrykeSdkErrorContextValue>
>;

const FORBIDDEN_CONTEXT_KEY =
  /(authorization|credential|secret|private|signed|signature|transaction|payload|api.?key|token)/i;

const safeContext = (
  context?: Readonly<Record<string, StrykeSdkErrorContextValue>>
): StrykeSdkErrorContext | undefined => {
  if (!context) return undefined;
  const entries = Object.entries(context).filter(
    ([key]) => !FORBIDDEN_CONTEXT_KEY.test(key)
  );
  return entries.length === 0 ? undefined : Object.freeze(Object.fromEntries(entries));
};

export class StrykeSdkError extends Error {
  readonly context: StrykeSdkErrorContext | undefined;

  constructor(
    readonly code: StrykeSdkErrorCode,
    message: string,
    readonly retryable = false,
    context?: Readonly<Record<string, StrykeSdkErrorContextValue>>
  ) {
    super(message);
    this.name = "StrykeSdkError";
    this.context = safeContext(context);
  }
}
