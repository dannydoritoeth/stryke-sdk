import { describe, expect, it, vi } from "vitest";

const hermes = vi.hoisted(() => {
  const stream = {
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    onerror: null as ((error: unknown) => void) | null,
    close: vi.fn(),
  };
  return {
    stream,
    getPriceUpdatesStream: vi.fn(async () => stream),
  };
});

vi.mock("@pythnetwork/hermes-client", () => ({
  HermesClient: class {
    getPriceUpdatesStream = hermes.getPriceUpdatesStream;
  },
}));

import { PYTH_FEED_IDS, PriceStore, subscribeHermes } from "../src/index.js";

const update = (publishTime: number) => ({
  parsed: [{
    id: PYTH_FEED_IDS.BTC.slice(2),
    price: { price: "7000000000000", expo: -8, publish_time: publishTime },
  }],
});

describe("Hermes disconnect production reproduction", () => {
  it("clears_the_price_and_never_reconnects_after_the_stream_errors", async () => {
    const now = 1_800_000_000_000;
    const store = new PriceStore({ now: () => now });
    const errors: unknown[] = [];
    const subscription = await subscribeHermes({
      endpoint: "https://hermes.example.test",
      assets: ["BTC"],
      store,
      onError: (error) => errors.push(error),
    });
    hermes.stream.onmessage?.({ data: JSON.stringify(update(now / 1_000)) } as MessageEvent<string>);
    expect(store.current("BTC").price).toBe(70_000);

    const disconnect = new Error("controlled Hermes stream disconnect");
    hermes.stream.onerror?.(disconnect);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.sourceState("BTC")).toBe("unavailable");
    expect(() => store.current("BTC")).toThrowError(expect.objectContaining({ code: "source_unavailable" }));
    expect(errors).toEqual([disconnect]);
    expect(hermes.getPriceUpdatesStream).toHaveBeenCalledOnce();
    expect(hermes.stream.close).not.toHaveBeenCalled();
    subscription.close();
  });
});
