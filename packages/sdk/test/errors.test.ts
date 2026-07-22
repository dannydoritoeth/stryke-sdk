import { describe, expect, it } from "vitest";

import {
  StrykeSdkError,
  STRYKE_SDK_ERROR_CODES,
  type StrykeSdkErrorCode,
} from "../src/index.js";

describe("typed SDK errors", () => {
  it("all_read_quote_failures_map_to_documented_typed_codes", () => {
    const codes = new Set<StrykeSdkErrorCode>(STRYKE_SDK_ERROR_CODES);
    for (const code of codes) {
      expect(new StrykeSdkError(code, code).code).toBe(code);
    }
    expect(codes).toEqual(
      new Set([
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
      ])
    );
  });

  it("typed_error_context_excludes_secrets_and_signed_payloads", () => {
    const error = new StrykeSdkError("api_response", "safe", false, {
      status: 409,
      path: "/v1/quote",
      authorization: "Bearer secret",
      apiKey: "secret",
      signature: "signed-value",
      signedTransaction: "bytes",
      payload: "raw-body",
    });
    expect(error.context).toEqual({ status: 409, path: "/v1/quote" });
    expect(JSON.stringify(error)).not.toMatch(/Bearer|signed-value|raw-body|secret/);
  });
});
