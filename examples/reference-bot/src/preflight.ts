import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { StrykeSdkError } from "@stryke/sdk";

import type { ReferenceBotProfile } from "./config.js";

export type PreflightCheck =
  | "environment"
  | "api"
  | "pyth"
  | "pyth_history"
  | "wallet"
  | "rpc"
  | "funding";

type PreflightStatus = "checking" | "passed" | "skipped" | "failed";

export const DEVNET_EXECUTION_BUFFER_LAMPORTS = 10_000_000n;

export const emitPreflight = (
  profile: ReferenceBotProfile,
  check: PreflightCheck,
  status: PreflightStatus,
  message: string,
  remediation?: string
): void => {
  console.log(JSON.stringify({
    event: "reference_bot_preflight",
    profile,
    check,
    status,
    message,
    ...(remediation ? { remediation } : {}),
  }));
};

export const requireRootEnvFile = (profile: ReferenceBotProfile): void => {
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), ".env");
  if (!existsSync(path)) {
    const remediation = "Run `cp .env.example .env`, then inspect the values and retry.";
    emitPreflight(profile, "environment", "failed", "Repository-root .env file is missing.", remediation);
    throw new StrykeSdkError("configuration", remediation);
  }
  emitPreflight(profile, "environment", "passed", "Loaded repository-root .env configuration.");
};

export const runPreflightCheck = async <T>(
  profile: ReferenceBotProfile,
  check: PreflightCheck,
  message: string,
  remediation: string,
  operation: () => Promise<T>
): Promise<T> => {
  emitPreflight(profile, check, "checking", message);
  try {
    const value = await operation();
    emitPreflight(profile, check, "passed", message);
    return value;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown startup failure";
    emitPreflight(profile, check, "failed", detail, remediation);
    if (error instanceof StrykeSdkError) throw error;
    throw new StrykeSdkError("configuration", `${detail} ${remediation}`);
  }
};

export const requiredDevnetBalance = (maximumTradeSizeLamports: bigint): bigint =>
  maximumTradeSizeLamports + DEVNET_EXECUTION_BUFFER_LAMPORTS;
