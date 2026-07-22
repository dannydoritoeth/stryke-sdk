const SENSITIVE_KEY = /(authorization|private|secret|seed|mnemonic|keypair|walletmaterial|signedtransaction|rawtransaction)/i;

export type DecisionEvent = {
  event: "reference_bot_decision";
  market: unknown;
  marketState: string;
  marketStateVersion: string;
  pyth: unknown;
  fairProbability: number;
  quote: unknown;
  decision: unknown;
  safetyChecks: unknown;
  clientActionId?: string;
  transaction?: unknown;
  position?: unknown;
};

export const redactLogValue = (value: unknown, key = ""): unknown => {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactLogValue(child, childKey)]));
  }
  return value;
};

export const emitDecision = (
  event: DecisionEvent,
  write: (line: string) => void = console.log
): void => write(JSON.stringify(redactLogValue(event)));
