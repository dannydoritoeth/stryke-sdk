import { describe, expect, it } from "vitest";

import { PYTH_FEED_IDS, PriceStore, StrykeSdkError } from "../src/index.js";

const update = (
  asset: "BTC" | "SOL",
  publishTime: number,
  price = "7000000000000",
  expo = -8
) => ({
  parsed: [
    {
      id: PYTH_FEED_IDS[asset].slice(2),
      price: { price, expo, publish_time: publishTime },
    },
  ],
});

describe("Pyth price store", () => {
  it("maps_btc_and_sol_to_approved_fixed_pyth_feeds", () => {
    expect(PYTH_FEED_IDS).toEqual({
      BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
      SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    });
  });

  it("normalizes_exponent_and_appends_bounded_history", () => {
    let now = 1_800_000_000_000;
    const store = new PriceStore({ now: () => now, maximumHistoryPoints: 2 });

    expect(store.ingest("BTC", update("BTC", 1_800_000_000))).toMatchObject({
      feedId: PYTH_FEED_IDS.BTC,
      price: 70_000,
    });
    now += 1_000;
    store.ingest("BTC", update("BTC", 1_800_000_001, "7000100000000"));
    now += 1_000;
    store.ingest("BTC", update("BTC", 1_800_000_002, "7000200000000"));
    expect(store.history("BTC")).toHaveLength(2);
  });

  it("rejects_wrong_feed_future_stale_and_non_numeric_updates", () => {
    const now = 1_800_000_100_000;
    const store = new PriceStore({ now: () => now });

    expect(() => store.ingest("BTC", update("BTC", 1_800_000_000))).toThrow(
      StrykeSdkError
    );
    expect(() => store.ingest("BTC", update("BTC", 1_800_000_103))).toThrow(
      StrykeSdkError
    );
    expect(() => store.ingest("BTC", update("SOL", 1_800_000_100))).toThrow(
      StrykeSdkError
    );
    expect(() =>
      store.ingest("BTC", update("BTC", 1_800_000_100, "not-a-number"))
    ).toThrow(StrykeSdkError);
  });

  it("disconnect_marks_source_unavailable_before_reconnect", () => {
    const now = 1_800_000_000_000;
    const store = new PriceStore({ now: () => now });
    store.ingest("SOL", update("SOL", 1_800_000_000));
    store.unavailable("SOL");
    expect(store.sourceState("SOL")).toBe("unavailable");
    expect(() => store.current("SOL")).toThrowError(
      expect.objectContaining({ code: "source_unavailable" })
    );
  });

  it("reconnect_never_marks_cached_point_fresh", () => {
    const now = 1_800_000_000_000;
    const store = new PriceStore({ now: () => now });
    store.ingest("BTC", update("BTC", 1_800_000_000));
    expect(store.sourceState("BTC")).toBe("available");
    store.reconnecting("BTC");
    expect(store.sourceState("BTC")).toBe("reconnecting");
    expect(store.history("BTC")).toEqual([]);
    expect(() => store.current("BTC")).toThrowError(
      expect.objectContaining({ code: "source_unavailable" })
    );
    store.ingest("BTC", update("BTC", 1_800_000_000));
    expect(store.sourceState("BTC")).toBe("available");
  });
});
