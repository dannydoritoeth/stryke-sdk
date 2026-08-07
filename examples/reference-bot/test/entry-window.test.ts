import { describe, expect, it } from "vitest";
import { quote } from "./fixtures.js";
import { polymarketEntryWindow } from "../src/strategy/entry-window.js";

const market = { intervalStartTs: 1_799_999_700 } as never;
const input = { market, quote: quote(), earlyWindowSeconds: 60, lateWindowSeconds: 20, submissionBufferSeconds: 3 };

describe("Polymarket strategy entry windows", () => {
  it("early is start-inclusive and end-exclusive", () => {
    expect(polymarketEntryWindow({ ...input, mode: "polymarket_early", now: 1_799_999_699 }).reason).toBe("entry_window_not_open");
    expect(polymarketEntryWindow({ ...input, mode: "polymarket_early", now: 1_799_999_700 }).eligible).toBe(true);
    expect(polymarketEntryWindow({ ...input, mode: "polymarket_early", now: 1_799_999_760 }).reason).toBe("entry_window_closed");
  });

  it("late acts before fee onset and preserves a submission buffer", () => {
    expect(polymarketEntryWindow({ ...input, mode: "polymarket_late", now: 1_799_999_949 }).reason).toBe("entry_window_not_open");
    expect(polymarketEntryWindow({ ...input, mode: "polymarket_late", now: 1_799_999_950 }).eligible).toBe(true);
    expect(polymarketEntryWindow({ ...input, mode: "polymarket_late", now: 1_799_999_967 }).reason).toBe("entry_window_closed");
  });
});
