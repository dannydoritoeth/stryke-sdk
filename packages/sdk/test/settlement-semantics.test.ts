import { describe, expect, it } from "vitest";

import {
  firstVerifiedExpiryCrossingObservation,
  settlementOutcome,
  type SettlementObservation,
} from "../src/index.js";

const feed = "0xfeed";
const observation = (
  publishTime: number,
  overrides: Partial<SettlementObservation> = {}
): SettlementObservation => ({
  feedId: feed,
  publishTime,
  value: 101n,
  verified: true,
  raw: {},
  ...overrides,
});

describe("minimal-Pyth settlement semantics", () => {
  it("strict_greater_than_resolves_yes_and_equality_resolves_no", () => {
    expect(settlementOutcome(101n, 100n)).toBe("yes");
    expect(settlementOutcome(100n, 100n)).toBe("no");
    expect(settlementOutcome(99n, 100n)).toBe("no");
  });

  it("first_verified_expiry_crossing_pyth_observation_is_preserved", () => {
    const selected = firstVerifiedExpiryCrossingObservation({
      expectedFeedId: feed,
      expiryTs: 100,
      observations: [observation(99), observation(101), observation(102, { value: 999n })],
    });
    expect(selected).toMatchObject({ publishTime: 101, value: 101n, raw: {} });
  });

  it("wrong_feed_non_crossing_stale_partial_or_out_of_window_evidence_blocks", () => {
    for (const observations of [
      [observation(99), observation(101, { feedId: "wrong" })],
      [observation(99, { feedId: "wrong" }), observation(101)],
      [observation(101)],
      [observation(99), observation(101, { verified: false })],
      [observation(99, { verified: false }), observation(101)],
      [observation(99), observation(401)],
    ]) {
      expect(() =>
        firstVerifiedExpiryCrossingObservation({
          expectedFeedId: feed,
          expiryTs: 100,
          observations,
        })
      ).toThrowError(expect.objectContaining({ code: "position_state" }));
    }
  });
});
