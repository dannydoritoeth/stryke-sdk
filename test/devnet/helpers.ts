import evidence from "../../docs/evidence/devnet-lifecycle-matrix.json" with { type: "json" };

export type EvidenceCell = (typeof evidence.cells)[number];
export const matrixEvidence = evidence;

const rpcUrl = process.env.STRYKE_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";

export const verifyFinalized = async (signatures: readonly string[]) => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignatureStatuses",
      params: [signatures, { searchTransactionHistory: true }],
    }),
  });
  if (!response.ok) throw new Error(`Devnet RPC status ${response.status}`);
  const body = (await response.json()) as {
    error?: unknown;
    result?: { value?: Array<{ err: unknown; confirmationStatus?: string } | null> };
  };
  if (body.error || body.result?.value?.length !== signatures.length) {
    throw new Error("Devnet RPC returned incomplete signature evidence");
  }
  for (const status of body.result.value) {
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
