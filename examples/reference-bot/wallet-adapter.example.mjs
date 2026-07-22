import { readFile } from "node:fs/promises";

import { createKeyPairSignerFromBytes } from "@solana/kit";

const keypairPath = process.env.STRYKE_WALLET_KEYPAIR_PATH;
if (!keypairPath) throw new Error("STRYKE_WALLET_KEYPAIR_PATH is required");

const stored = JSON.parse(await readFile(keypairPath, "utf8"));
if (!Array.isArray(stored) || stored.length !== 64 || stored.some((byte) => !Number.isInteger(byte))) {
  throw new Error("Wallet keypair file must contain a 64-byte JSON array");
}

export default await createKeyPairSignerFromBytes(Uint8Array.from(stored));
