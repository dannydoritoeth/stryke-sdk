import { StrykeSdkError } from "@stryketrade/sdk";

export type RuntimeLeaseIdentity = {
  cluster: "mainnet-beta" | "devnet";
  wallet: string;
  asset: "BTC" | "SOL";
  expiryFamily: "one_minute" | "five_minute" | "fifteen_minute" | "hourly";
};

export interface RuntimeLease {
  readonly identity: RuntimeLeaseIdentity;
  readonly holderId: string;
  assertHeld(): Promise<void>;
  release(): Promise<void>;
}

export interface RuntimeLeaseStore {
  acquire(identity: RuntimeLeaseIdentity, holderId: string): Promise<RuntimeLease | undefined>;
}

export const requireRuntimeLease = async (
  store: RuntimeLeaseStore,
  identity: RuntimeLeaseIdentity,
  holderId: string
): Promise<RuntimeLease> => {
  const lease = await store.acquire(identity, holderId);
  if (!lease) {
    throw new StrykeSdkError(
      "configuration",
      "Another reference-bot process holds the runtime lease"
    );
  }
  return lease;
};

export const assertRuntimeLeaseHeld = async (lease: RuntimeLease): Promise<void> => {
  try {
    await lease.assertHeld();
  } catch {
    throw new StrykeSdkError(
      "configuration",
      "Reference-bot runtime lease is unavailable or was lost"
    );
  }
};
