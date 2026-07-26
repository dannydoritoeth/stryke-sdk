import type { ExecutableQuote } from "@stryke/sdk";

export type ActivationEntryDecision = { allowed: boolean; reason: string };

export const activationEntryDecision = (quote: ExecutableQuote): ActivationEntryDecision => {
  if (quote.closingProtection.phase !== "open") return { allowed: false, reason: `closing_${quote.closingProtection.phase}` };
  const mode = quote.feeBreakdown.feeMode.toLowerCase();
  if (!mode.includes("waived")) return { allowed: false, reason: "side_already_activated" };
  if (quote.closingProtection.effectiveFeeBps !== 0 || quote.feeBreakdown.feeBpsApplied !== 0) {
    return { allowed: false, reason: "fee_free_policy_incoherent" };
  }
  return { allowed: true, reason: "fee_free_open" };
};
