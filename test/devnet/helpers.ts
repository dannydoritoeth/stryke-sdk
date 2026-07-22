import evidence from "../../docs/evidence/devnet-lifecycle-matrix.json" with { type: "json" };

export type EvidenceCell = (typeof evidence.cells)[number];
export const matrixEvidence = evidence;

const rpcUrl = process.env.STRYKE_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";

export const devnetRpc = async <T>(method: string, params: unknown[] = []): Promise<T> => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (response.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1_000));
      continue;
    }
    if (!response.ok) throw new Error(`Devnet RPC status ${response.status}`);
    const body = (await response.json()) as { error?: unknown; result?: T };
    if (body.error || body.result === undefined) throw new Error("Devnet RPC request failed");
    return body.result;
  }
  throw new Error("Devnet RPC retry budget exhausted");
};

export const verifyFinalized = async (signatures: readonly string[]) => {
  const result = await devnetRpc<{
    value?: Array<{ err: unknown; confirmationStatus?: string } | null>;
  }>("getSignatureStatuses", [signatures, { searchTransactionHistory: true }]);
  if (result.value?.length !== signatures.length) {
    throw new Error("Devnet RPC returned incomplete signature evidence");
  }
  for (const status of result.value) {
    if (!status || status.err !== null || status.confirmationStatus !== "finalized") {
      throw new Error("Devnet lifecycle signature is not finalized successfully");
    }
  }
};

export const cell = (asset: "BTC" | "SOL", expiry: "1m" | "5m" | "15m" | "1h") => {
  const found = matrixEvidence.cells.find((row) => row.asset === asset && row.expiry === expiry);
  if (!found) throw new Error(`Missing ${asset} ${expiry} evidence`);
  return found;
};

export const verifyCell = async (asset: "BTC" | "SOL", expiry: "1m" | "5m" | "15m" | "1h") => {
  const found = cell(asset, expiry);
  await verifyFinalized([found.claim, found.refund, found.closed]);
};
