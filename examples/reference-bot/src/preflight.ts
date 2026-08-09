import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { StrykeSdkError } from "@stryketrade/sdk";

import type { ReferenceBotProfile } from "./config.js";

export type PreflightCheck =
  | "environment"
  | "api"
  | "market"
  | "pyth"
  | "pyth_history"
  | "wallet"
  | "rpc"
  | "funding";

type PreflightStatus = "checking" | "passed" | "skipped" | "failed";

export const EXECUTION_BUFFER_LAMPORTS = 10_000_000n;

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
  emitPreflight(profile, "environment", "passed", "Found repository-root .env; validating its configuration.");
};

export const runPreflightCheck = async <T>(
  profile: ReferenceBotProfile,
  check: PreflightCheck,
  message: string,
  remediation: string,
  operation: () => Promise<T>,
  options: { attempts?: number; retryDelayMs?: number; attemptTimeoutMs?: number } = {}
): Promise<T> => {
  emitPreflight(profile, check, "checking", message);
  const attempts = Math.max(1, options.attempts ?? 1);
  let finalError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const operationPromise = operation();
      const value = options.attemptTimeoutMs === undefined
        ? await operationPromise
        : await new Promise<T>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`${check} preflight timed out after ${options.attemptTimeoutMs}ms`)),
              options.attemptTimeoutMs
            );
            operationPromise.then(
              (result) => { clearTimeout(timer); resolve(result); },
              (error) => { clearTimeout(timer); reject(error); }
            );
          });
      emitPreflight(profile, check, "passed", message);
      return value;
    } catch (error) {
      finalError = error;
      if (attempt < attempts && (options.retryDelayMs ?? 0) > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs));
      }
    }
  }
  const detail = finalError instanceof Error ? finalError.message : "Unknown startup failure";
  emitPreflight(profile, check, "failed", detail, remediation);
  if (finalError instanceof StrykeSdkError) throw finalError;
  throw new StrykeSdkError("configuration", `${detail} ${remediation}`);
};

export const runContinuousMarketPreflight = async <T>(
  profile: ReferenceBotProfile,
  operation: () => Promise<T>
): Promise<"passed" | "waiting"> => {
  const message = "Validated a current market response.";
  emitPreflight(profile, "market", "checking", message);
  try {
    await operation();
    emitPreflight(profile, "market", "passed", message);
    return "passed";
  } catch (error) {
    if (error instanceof StrykeSdkError && error.retryable) {
      emitPreflight(
        profile,
        "market",
        "skipped",
        `Current market is temporarily unavailable; the continuous runtime will retry (${error.code}).`
      );
      return "waiting";
    }
    const detail = error instanceof Error ? error.message : "Invalid market response";
    const remediation = "Check that the Stryke API market contract is compatible with this SDK release.";
    emitPreflight(profile, "market", "failed", detail, remediation);
    throw error instanceof StrykeSdkError
      ? error
      : new StrykeSdkError("configuration", `${detail} ${remediation}`);
  }
};

export const requiredExecutionBalance = (maximumTradeSizeLamports: bigint): bigint =>
  maximumTradeSizeLamports + EXECUTION_BUFFER_LAMPORTS;
