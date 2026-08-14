import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type RoundIdentity = { marketId: string; expiryTs: number; strikePrice: string };
export type PositionRoundIdentity = RoundIdentity & { positionId: string };
export const roundKey = (round: RoundIdentity) => `${round.marketId}:${round.expiryTs}:${round.strikePrice}`;
const positionRoundKey = (identity: PositionRoundIdentity) => `${roundKey(identity)}:${identity.positionId}`;

export interface RoundDecisionStore {
  hasConvergenceExit(round: RoundIdentity): Promise<boolean>;
  recordConvergenceExit(round: RoundIdentity): Promise<void>;
  hasEntry(round: RoundIdentity): Promise<boolean>;
  recordEntry(round: RoundIdentity): Promise<void>;
  hasPreFeeRevalidation(identity: PositionRoundIdentity): Promise<boolean>;
  recordPreFeeRevalidation(identity: PositionRoundIdentity, outcome: string): Promise<void>;
}

export class MemoryRoundDecisionStore implements RoundDecisionStore {
  private readonly keys = new Set<string>();
  private readonly entries = new Set<string>();
  private readonly revalidations = new Map<string, string>();
  async hasConvergenceExit(round: RoundIdentity) { return this.keys.has(roundKey(round)); }
  async recordConvergenceExit(round: RoundIdentity) { this.keys.add(roundKey(round)); }
  async hasEntry(round: RoundIdentity) { return this.entries.has(roundKey(round)); }
  async recordEntry(round: RoundIdentity) { this.entries.add(roundKey(round)); }
  async hasPreFeeRevalidation(identity: PositionRoundIdentity) { return this.revalidations.has(positionRoundKey(identity)); }
  async recordPreFeeRevalidation(identity: PositionRoundIdentity, outcome: string) { this.revalidations.set(positionRoundKey(identity), outcome); }
}

export class FileRoundDecisionStore implements RoundDecisionStore {
  constructor(private readonly path: string) {}
  private async load(): Promise<{ exits: Set<string>; entries: Set<string>; revalidations: Map<string, string> }> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as { schemaVersion?: string; convergenceExitedRounds?: unknown; enteredRounds?: unknown };
      if (parsed.schemaVersion !== "stryke.referenceBotRoundState.v1" || !Array.isArray(parsed.convergenceExitedRounds) || parsed.convergenceExitedRounds.some((key) => typeof key !== "string")) throw new Error("invalid round state");
      const entries = "enteredRounds" in parsed && Array.isArray(parsed.enteredRounds) && parsed.enteredRounds.every((key) => typeof key === "string") ? parsed.enteredRounds as string[] : [];
      const values = (parsed as { preFeeRevalidations?: unknown }).preFeeRevalidations;
      const revalidations = values && typeof values === "object" && !Array.isArray(values) ? new Map(Object.entries(values as Record<string, string>).filter((entry) => typeof entry[1] === "string")) : new Map<string, string>();
      return { exits: new Set(parsed.convergenceExitedRounds as string[]), entries: new Set(entries), revalidations };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exits: new Set(), entries: new Set(), revalidations: new Map() };
      throw error;
    }
  }
  async hasConvergenceExit(round: RoundIdentity) { return (await this.load()).exits.has(roundKey(round)); }
  async hasEntry(round: RoundIdentity) { return (await this.load()).entries.has(roundKey(round)); }
  private async save(exits: Set<string>, entries: Set<string>, revalidations: Map<string, string>) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: "stryke.referenceBotRoundState.v1", convergenceExitedRounds: [...exits].sort(), enteredRounds: [...entries].sort(), preFeeRevalidations: Object.fromEntries([...revalidations].sort()) })}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }
  async recordConvergenceExit(round: RoundIdentity) {
    const state = await this.load(); state.exits.add(roundKey(round)); await this.save(state.exits, state.entries, state.revalidations);
  }
  async recordEntry(round: RoundIdentity) { const state = await this.load(); state.entries.add(roundKey(round)); await this.save(state.exits, state.entries, state.revalidations); }
  async hasPreFeeRevalidation(identity: PositionRoundIdentity) { return (await this.load()).revalidations.has(positionRoundKey(identity)); }
  async recordPreFeeRevalidation(identity: PositionRoundIdentity, outcome: string) { const state = await this.load(); state.revalidations.set(positionRoundKey(identity), outcome); await this.save(state.exits, state.entries, state.revalidations); }
}
