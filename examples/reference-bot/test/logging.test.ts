import { describe, expect, it, vi } from "vitest";

import { emitDecision } from "../src/logging.js";

const event = () => ({
  event: "reference_bot_decision" as const,
  market: { asset: "BTC", expiry: "five_minute" },
  marketState: "open",
  marketStateVersion: "state-1",
  pyth: { feedId: "feed", price: "100", publishTime: 1 },
  fairProbability: 0.6,
  quote: { quoteId: "q", executableProbability: 0.5 },
  decision: { action: "buy", reason: "edge" },
  safetyChecks: { edge: true },
  clientActionId: "a",
  transaction: { state: "confirmed" },
  position: { state: "open_position" },
});

describe("structured decision logs", () => {
  it("decision_lifecycle_emits_required_structured_fields", () => {
    const write = vi.fn();
    emitDecision(event(), write);
    expect(JSON.parse(write.mock.calls[0]![0])).toMatchObject(event());
  });

  it("logs_redact_private_auth_and_signed_transaction_material", () => {
    const write = vi.fn();
    emitDecision({ ...event(), transaction: { authorization: "Bearer secret", signedTransaction: "bytes", signature: "public-signature" }, position: { privateKey: "secret" } }, write);
    const output = write.mock.calls[0]![0] as string;
    expect(output).not.toContain("Bearer secret");
    expect(output).not.toContain("bytes");
    expect(output).not.toContain('"secret"');
    expect(output).toContain("public-signature");
  });
});
