import { Client, StreamableHTTPClientTransport, type CallToolResult, type Tool } from "@modelcontextprotocol/client";

export const STRYKE_MCP_ENDPOINT = "https://api.stryketrade.com/mcp";
export const STRYKE_MCP_BUNDLE_VERSION = "1.0.0";
export const STRYKE_MCP_PROTOCOL_VERSION = "2025-11-25";
export const STRYKE_MCP_TOOL_NAMES = [
  "stryke_get_environment",
  "stryke_get_current_pyth_markets",
  "stryke_get_market",
  "stryke_preview_quote",
] as const;

export type StrykeMcpToolName = (typeof STRYKE_MCP_TOOL_NAMES)[number];
export type StrykeMcpSymbol = "BTC" | "SOL";
export type StrykeMcpExpiryFamily = "one_minute" | "five_minute" | "fifteen_minute" | "hourly";
export type StrykeMcpMarketState = "tradable" | "all";
export type StrykeMcpQuoteAction = "buy" | "sell";
export type StrykeMcpQuoteSide = "up" | "down";
export type StrykeMcpAmountUnit = "SOL" | "shares";

export type StrykeMcpErrorBody = {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  remediation?: string;
};

export type StrykeMcpEnvironment = {
  apiVersion: string;
  mcpVersion: string;
  environment: string;
  network: string;
  anonymous: boolean;
  readOnly: boolean;
  supportedSymbols: StrykeMcpSymbol[];
  collateral: { symbol: "SOL"; decimals: number };
  expiryFamilies: StrykeMcpExpiryFamily[];
  source: "pyth_oracle";
  toolCount: number;
  generatedAt: string;
};

export type StrykeMcpMarket = {
  marketId: string;
  symbol: StrykeMcpSymbol;
  source: "pyth_oracle";
  expiryFamily: StrykeMcpExpiryFamily;
  expiryTs: number;
  intervalLifecycle: string;
  tradeability: { canQuote: boolean; disabledReasons: string[] };
  sourceHealth?: { stale: boolean; healthState?: string; observedAt?: string; staleAfter?: string };
  [key: string]: unknown;
};

export type StrykeMcpCurrentMarkets = {
  symbol: StrykeMcpSymbol;
  source: "pyth_oracle";
  collateral: "SOL";
  state: StrykeMcpMarketState;
  markets: StrykeMcpMarket[];
  generatedAt: string;
  stale: boolean;
};

export type StrykeMcpMarketDetail = {
  market: StrykeMcpMarket;
  metadata: Record<string, unknown>;
  sourceHealth: { stale: boolean; healthState?: string; observedAt?: string; staleAfter?: string; [key: string]: unknown };
};

export type StrykeMcpQuotePreview = {
  marketId: string;
  action: StrykeMcpQuoteAction;
  side: StrykeMcpQuoteSide;
  input: { value: string; unit: StrykeMcpAmountUnit; baseUnits: string };
  output: Record<string, unknown>;
  generatedAt: string;
  stale: boolean;
};

export type StrykeMcpCurrentMarketsInput = {
  symbol: StrykeMcpSymbol;
  expiryFamily?: StrykeMcpExpiryFamily;
  collateral?: "SOL";
  state?: StrykeMcpMarketState;
};

export type StrykeMcpQuotePreviewInput = {
  marketId: string;
  action: StrykeMcpQuoteAction;
  side: StrykeMcpQuoteSide;
  amount: { value: string; unit: StrykeMcpAmountUnit };
};

export type StrykeReadOnlyMcpClientOptions = {
  endpoint?: string | URL;
  fetch?: typeof globalThis.fetch;
  clientName?: string;
  clientVersion?: string;
};

export class StrykeMcpToolError extends Error {
  readonly name = "StrykeMcpToolError";

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
    readonly remediation?: string
  ) {
    super(message);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const forbiddenMaterialKeys = new Set([
  "instructions",
  "serializedTransaction",
  "signedTransaction",
  "transactionBytes",
  "signature",
  "privateKey",
  "secretKey",
]);

const rejectMutationMaterial = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) rejectMutationMaterial(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenMaterialKeys.has(key)) {
      throw new StrykeMcpToolError("compatibility", `Read-only MCP response unexpectedly included ${key}`, false);
    }
    rejectMutationMaterial(child);
  }
};

const assertExactReadOnlyTools = (tools: Tool[]): void => {
  const names = tools.map(({ name }) => name);
  if (JSON.stringify(names) !== JSON.stringify(STRYKE_MCP_TOOL_NAMES)) {
    throw new StrykeMcpToolError("compatibility", `Unexpected Stryke MCP tools: ${names.join(", ")}`, false);
  }
  for (const tool of tools) {
    if (tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint === true) {
      throw new StrykeMcpToolError("compatibility", `MCP tool ${tool.name} is not strictly read-only`, false);
    }
  }
};

const parseToolResult = <T>(result: CallToolResult): T => {
  const envelope = result.structuredContent;
  if (!isRecord(envelope) || typeof envelope.ok !== "boolean") {
    throw new StrykeMcpToolError("compatibility", "MCP tool returned invalid structured content", false);
  }
  if (!envelope.ok) {
    const error = envelope.error;
    if (!isRecord(error) || typeof error.code !== "string" || typeof error.message !== "string" || typeof error.retryable !== "boolean") {
      throw new StrykeMcpToolError("compatibility", "MCP tool returned an invalid structured error", false);
    }
    throw new StrykeMcpToolError(
      error.code,
      error.message,
      error.retryable,
      typeof error.retryAfterMs === "number" ? error.retryAfterMs : undefined,
      typeof error.remediation === "string" ? error.remediation : undefined
    );
  }
  if (!("data" in envelope)) {
    throw new StrykeMcpToolError("compatibility", "MCP tool success response omitted data", false);
  }
  rejectMutationMaterial(envelope.data);
  return envelope.data as T;
};

export class StrykeReadOnlyMcpClient {
  private constructor(
    private readonly client: Client,
    readonly protocolVersion: string,
    readonly serverInfo: { name: string; version: string }
  ) {}

  static async connect(options: StrykeReadOnlyMcpClientOptions = {}): Promise<StrykeReadOnlyMcpClient> {
    let endpoint: URL;
    try {
      endpoint = new URL(options.endpoint ?? STRYKE_MCP_ENDPOINT);
    } catch {
      throw new StrykeMcpToolError("configuration", "MCP endpoint must be an absolute URL", false);
    }
    const client = new Client({
      name: options.clientName ?? "stryketrade-sdk",
      version: options.clientVersion ?? STRYKE_MCP_BUNDLE_VERSION,
    });
    try {
      await client.connect(new StreamableHTTPClientTransport(endpoint, { ...(options.fetch ? { fetch: options.fetch } : {}) }));
      assertExactReadOnlyTools((await client.listTools()).tools);
      const protocolVersion = client.getNegotiatedProtocolVersion();
      const serverInfo = client.getServerVersion();
      if (protocolVersion !== STRYKE_MCP_PROTOCOL_VERSION || !serverInfo) {
        throw new StrykeMcpToolError("compatibility", "Stryke MCP protocol or server identity is unsupported", false);
      }
      return new StrykeReadOnlyMcpClient(client, protocolVersion, serverInfo);
    } catch (error) {
      await client.close().catch(() => undefined);
      if (error instanceof StrykeMcpToolError) throw error;
      throw new StrykeMcpToolError("source_unavailable", "Could not connect to the Stryke MCP endpoint", true);
    }
  }

  close(): Promise<void> {
    return this.client.close();
  }

  async getEnvironment(): Promise<StrykeMcpEnvironment> {
    const data = parseToolResult<StrykeMcpEnvironment>(await this.client.callTool({ name: "stryke_get_environment", arguments: {} }));
    if (data.anonymous !== true || data.readOnly !== true || data.toolCount !== STRYKE_MCP_TOOL_NAMES.length) {
      throw new StrykeMcpToolError("compatibility", "Stryke MCP environment is not anonymous read-only Phase A", false);
    }
    return data;
  }

  async getCurrentPythMarkets(input: StrykeMcpCurrentMarketsInput): Promise<StrykeMcpCurrentMarkets> {
    return parseToolResult(await this.client.callTool({ name: "stryke_get_current_pyth_markets", arguments: input }));
  }

  async getMarket(marketId: string): Promise<StrykeMcpMarketDetail> {
    return parseToolResult(await this.client.callTool({ name: "stryke_get_market", arguments: { marketId } }));
  }

  async previewQuote(input: StrykeMcpQuotePreviewInput): Promise<StrykeMcpQuotePreview> {
    if ((input.action === "buy" && input.amount.unit !== "SOL") || (input.action === "sell" && input.amount.unit !== "shares")) {
      throw new StrykeMcpToolError("invalid_input", "Buy amounts use SOL and sell amounts use shares", false);
    }
    return parseToolResult(await this.client.callTool({ name: "stryke_preview_quote", arguments: input }));
  }
}
