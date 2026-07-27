import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type RoundIdentity = { marketId: string; expiryTs: number; strikePrice: string };
export const roundKey = (round: RoundIdentity) => `${round.marketId}:${round.expiryTs}:${round.strikePrice}`;

export interface RoundDecisionStore {
  hasConvergenceExit(round: RoundIdentity): Promise<boolean>;
  recordConvergenceExit(round: RoundIdentity): Promise<void>;
}

export class MemoryRoundDecisionStore implements RoundDecisionStore {
  private readonly keys = new Set<string>();
  async hasConvergenceExit(round: RoundIdentity) { return this.keys.has(roundKey(round)); }
  async recordConvergenceExit(round: RoundIdentity) { this.keys.add(roundKey(round)); }
}

export class FileRoundDecisionStore implements RoundDecisionStore {
  constructor(private readonly path: string) {}
  private async load(): Promise<Set<string>> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as { schemaVersion?: string; convergenceExitedRounds?: unknown };
      if (parsed.schemaVersion !== "stryke.referenceBotRoundState.v1" || !Array.isArray(parsed.convergenceExitedRounds) || parsed.convergenceExitedRounds.some((key) => typeof key !== "string")) throw new Error("invalid round state");
      return new Set(parsed.convergenceExitedRounds as string[]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
      throw error;
    }
  }
  async hasConvergenceExit(round: RoundIdentity) { return (await this.load()).has(roundKey(round)); }
  async recordConvergenceExit(round: RoundIdentity) {
    const keys = await this.load();
    keys.add(roundKey(round));
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: "stryke.referenceBotRoundState.v1", convergenceExitedRounds: [...keys].sort() })}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }
}
