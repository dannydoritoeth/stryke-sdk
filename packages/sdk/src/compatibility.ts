import { StrykeSdkError } from "./errors.js";

export const SDK_VERSION = "0.1.26" as const;
export const SUPPORTED_API_VERSION = "v1" as const;
export const SUPPORTED_API_SCHEMA_VERSION = "1.0.0" as const;
export const SUPPORTED_PROGRAM_ID =
  "GmXBVbwqBhjetu9VSbFoQQMHDi22WAMBn4oNwj9sjnSE" as const;
export const SUPPORTED_PROGRAM_VERSION = "0.1.0" as const;
export const SUPPORTED_QUOTE_MATH_VERSION = "independent_curve_v1" as const;
export const SUPPORTED_CLUSTERS = ["mainnet-beta", "devnet"] as const;
export type SupportedCluster = (typeof SUPPORTED_CLUSTERS)[number];

export const PILOT_ASSETS = ["BTC", "SOL"] as const;
export const PILOT_EXPIRY_FAMILIES = [
  "one_minute",
  "five_minute",
  "fifteen_minute",
  "hourly",
] as const;

export type PilotAsset = (typeof PILOT_ASSETS)[number];
export type PilotExpiryFamily = (typeof PILOT_EXPIRY_FAMILIES)[number];

export type ApiCapabilitiesV1 = {
  apiVersion: "v1";
  schemaVersion: string;
  apiServiceVersion: string;
  compatibility: { minimumSdkVersion: string };
  cluster: SupportedCluster;
  contract: {
    profile: "minimal_pyth";
    programId: string;
    programVersion: string;
    idlSpecVersion: string;
    deployedRules: {
      schemaVersion: "1.0.0";
      environment: "production" | "devnet";
      sourceCommit: string;
      binarySha256: string;
      settlementMode: "historical_expiry_price_atomic" | "first_valid_post_expiry";
      forceCloseSeconds: 7_776_000;
      ownerCloseHasGracePeriod: false;
      manifestUrl?: string;
    };
  };
  assets: ReadonlyArray<{
    symbol: string;
    pythFeedId: string;
    state?: "enabled";
    enabledExpiryFamilies?: readonly PilotExpiryFamily[];
  }>;
  expiryFamilies: readonly PilotExpiryFamily[];
  actions: readonly ("buy" | "sell" | "claim" | "refund")[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new StrykeSdkError("compatibility", `Missing capability field: ${name}`);
  }
  return value;
};

export const parseCapabilitiesV1 = (value: unknown): ApiCapabilitiesV1 => {
  if (!isRecord(value) || !isRecord(value.contract) || !isRecord(value.compatibility)) {
    throw new StrykeSdkError("compatibility", "Invalid API capability response");
  }
  const assets = value.assets;
  const expiryFamilies = value.expiryFamilies;
  const actions = value.actions;
  if (!Array.isArray(assets) || !Array.isArray(expiryFamilies) || !Array.isArray(actions)) {
    throw new StrykeSdkError("compatibility", "Capability matrices are missing");
  }

  if (!isRecord(value.contract.deployedRules)) {
    throw new StrykeSdkError("compatibility", "Missing deployed rule contract");
  }
  const deployedRules = value.contract.deployedRules;
  const parsed = {
    apiVersion: stringField(value.apiVersion, "apiVersion"),
    schemaVersion: stringField(value.schemaVersion, "schemaVersion"),
    apiServiceVersion: stringField(value.apiServiceVersion, "apiServiceVersion"),
    compatibility: {
      minimumSdkVersion: stringField(
        value.compatibility.minimumSdkVersion,
        "compatibility.minimumSdkVersion"
      ),
    },
    cluster: stringField(value.cluster, "cluster"),
    contract: {
      profile: stringField(value.contract.profile, "contract.profile"),
      programId: stringField(value.contract.programId, "contract.programId"),
      programVersion: stringField(
        value.contract.programVersion,
        "contract.programVersion"
      ),
      idlSpecVersion: stringField(
        value.contract.idlSpecVersion,
        "contract.idlSpecVersion"
      ),
      deployedRules: {
        schemaVersion: stringField(deployedRules.schemaVersion, "contract.deployedRules.schemaVersion"),
        environment: stringField(deployedRules.environment, "contract.deployedRules.environment"),
        sourceCommit: stringField(deployedRules.sourceCommit, "contract.deployedRules.sourceCommit"),
        binarySha256: stringField(deployedRules.binarySha256, "contract.deployedRules.binarySha256"),
        settlementMode: stringField(deployedRules.settlementMode, "contract.deployedRules.settlementMode"),
        forceCloseSeconds: deployedRules.forceCloseSeconds,
        ownerCloseHasGracePeriod: deployedRules.ownerCloseHasGracePeriod,
        ...(typeof deployedRules.manifestUrl === "string" ? { manifestUrl: deployedRules.manifestUrl } : {}),
      },
    },
    assets,
    expiryFamilies,
    actions,
  };

  if (
    parsed.apiVersion !== SUPPORTED_API_VERSION ||
    parsed.schemaVersion !== SUPPORTED_API_SCHEMA_VERSION ||
    !SUPPORTED_CLUSTERS.includes(parsed.cluster as SupportedCluster) ||
    parsed.contract.profile !== "minimal_pyth" ||
    parsed.contract.programId !== SUPPORTED_PROGRAM_ID ||
    parsed.contract.programVersion !== SUPPORTED_PROGRAM_VERSION ||
    parsed.contract.deployedRules.schemaVersion !== "1.0.0" ||
    parsed.contract.deployedRules.forceCloseSeconds !== 7_776_000 ||
    parsed.contract.deployedRules.ownerCloseHasGracePeriod !== false ||
    (parsed.cluster === "mainnet-beta" &&
      (parsed.contract.deployedRules.environment !== "production" ||
        parsed.contract.deployedRules.sourceCommit !== "9f8df797c404fff7a965fc462d88d9bfb10b9900" ||
        parsed.contract.deployedRules.binarySha256 !== "6ec28ae515e5e0d6828dde513ba76ccf142a830c1b0efc6c1bbfad150c11fed7" ||
        parsed.contract.deployedRules.settlementMode !== "historical_expiry_price_atomic")) ||
    (parsed.cluster === "devnet" &&
      (parsed.contract.deployedRules.environment !== "devnet" ||
        parsed.contract.deployedRules.sourceCommit !== "8a421a7d3f9fba4c6df667e47b9833c95a543983" ||
        parsed.contract.deployedRules.binarySha256 !== "332a3cb8c6b4fea0655b103cbab932ca5c8234e0ebef7910a418824b14bb4279" ||
        parsed.contract.deployedRules.settlementMode !== "first_valid_post_expiry"))
  ) {
    throw new StrykeSdkError("compatibility", "Unsupported Stryke deployment", false, {
      apiVersion: parsed.apiVersion,
      schemaVersion: parsed.schemaVersion,
      cluster: parsed.cluster,
      contractProfile: parsed.contract.profile,
      programId: parsed.contract.programId,
      programVersion: parsed.contract.programVersion,
    });
  }
  for (const asset of PILOT_ASSETS) {
    if (!assets.some((row) => isRecord(row) && row.symbol === asset)) {
      throw new StrykeSdkError("compatibility", `Missing pilot asset: ${asset}`);
    }
  }
  const seenAssets = new Set<string>();
  for (const [index, asset] of assets.entries()) {
    if (
      !isRecord(asset) ||
      typeof asset.symbol !== "string" ||
      !/^[A-Z0-9]{2,12}$/.test(asset.symbol) ||
      typeof asset.pythFeedId !== "string" ||
      asset.pythFeedId.length === 0 ||
      (asset.state !== undefined && asset.state !== "enabled") ||
      seenAssets.has(asset.symbol)
    ) {
      throw new StrykeSdkError(
        "compatibility",
        `Invalid capability asset at index ${index}`
      );
    }
    seenAssets.add(asset.symbol);
    if (
      asset.enabledExpiryFamilies !== undefined &&
      (!Array.isArray(asset.enabledExpiryFamilies) ||
        asset.enabledExpiryFamilies.some(
          (family) => !PILOT_EXPIRY_FAMILIES.includes(family as PilotExpiryFamily)
        ))
    ) {
      throw new StrykeSdkError(
        "compatibility",
        `Invalid expiry matrix for capability asset: ${asset.symbol}`
      );
    }
  }
  for (const expiry of PILOT_EXPIRY_FAMILIES) {
    if (!expiryFamilies.includes(expiry)) {
      throw new StrykeSdkError("compatibility", `Missing pilot expiry: ${expiry}`);
    }
  }

  return parsed as ApiCapabilitiesV1;
};
