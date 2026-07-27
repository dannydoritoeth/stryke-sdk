import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { PilotActionState } from "./transactions.js";

export type ActionCheckpoint = {
  clientActionId: string;
  intentHash: string;
  state: PilotActionState;
  signature?: string;
  materialization?: {
    action: "buy" | "sell" | "claim" | "refund";
    asset: "BTC" | "SOL";
    expiryFamily: "one_minute" | "five_minute" | "fifteen_minute" | "hourly";
    expiryTs: number;
    targetValue: string;
    marketId?: string;
    positionId?: string;
    sharesBefore?: string;
    strategyReason?: string;
  };
};

export interface ActionCheckpointStore {
  load(): Promise<ActionCheckpoint | undefined>;
  save(checkpoint: ActionCheckpoint): Promise<void>;
  clear(expectedClientActionId: string): Promise<void>;
}

export class MemoryActionCheckpointStore implements ActionCheckpointStore {
  private checkpoint: ActionCheckpoint | undefined;

  async load() {
    return this.checkpoint ? { ...this.checkpoint } : undefined;
  }

  async save(checkpoint: ActionCheckpoint) {
    this.checkpoint = { ...checkpoint };
  }

  async clear(expectedClientActionId: string) {
    if (this.checkpoint?.clientActionId === expectedClientActionId) {
      this.checkpoint = undefined;
    }
  }
}

export class FileActionCheckpointStore implements ActionCheckpointStore {
  constructor(private readonly path: string) {}

  async load(): Promise<ActionCheckpoint | undefined> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as ActionCheckpoint;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(checkpoint: ActionCheckpoint): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }

  async clear(expectedClientActionId: string): Promise<void> {
    const current = await this.load();
    if (current?.clientActionId === expectedClientActionId) {
      await rm(this.path, { force: true });
    }
  }
}
