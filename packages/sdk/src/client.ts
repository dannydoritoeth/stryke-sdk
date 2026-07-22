import {
  SUPPORTED_API_VERSION,
  parseCapabilitiesV1,
  type ApiCapabilitiesV1,
} from "./compatibility.js";
import { StrykeSdkError } from "./errors.js";
import type { StrykeSdkErrorCode } from "./errors.js";

const apiErrorCode = (code?: string): StrykeSdkErrorCode => {
  if (!code) return "api_response";
  if (/stale/i.test(code)) return "source_stale";
  if (/unavailable|not_found|read_models/i.test(code)) return "source_unavailable";
  if (/quote|market_state|slippage/i.test(code)) return "quote_blocked";
  if (/unsupported.*asset/i.test(code)) return "unsupported_asset";
  if (/unsupported.*expir/i.test(code)) return "unsupported_expiry";
  if (/compatib|api_major|schema/i.test(code)) return "compatibility";
  return "api_response";
};

export type StrykeClientOptions = {
  apiBaseUrl: string;
  fetch?: typeof globalThis.fetch;
};

export class StrykeClient {
  private constructor(
    readonly apiBaseUrl: string,
    readonly capabilities: ApiCapabilitiesV1,
    private readonly request: typeof globalThis.fetch
  ) {}

  static async connect(options: StrykeClientOptions): Promise<StrykeClient> {
    let baseUrl: URL;
    try {
      baseUrl = new URL(options.apiBaseUrl);
    } catch {
      throw new StrykeSdkError("configuration", "apiBaseUrl must be an absolute URL");
    }
    const request = options.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await request(new URL("/v1/capabilities", baseUrl));
    } catch {
      throw new StrykeSdkError(
        "source_unavailable",
        "Capability request could not reach the API",
        true
      );
    }
    if (!response.ok) {
      throw new StrykeSdkError(
        "api_response",
        `Capability request failed with ${response.status}`,
        response.status >= 500,
        { status: response.status, path: "/v1/capabilities" }
      );
    }
    const headerVersion = response.headers.get("Stryke-Api-Version");
    if (headerVersion !== SUPPORTED_API_VERSION) {
      throw new StrykeSdkError("compatibility", "API version header is missing or unsupported");
    }
    const capabilities = parseCapabilitiesV1(await response.json());
    return new StrykeClient(baseUrl.toString().replace(/\/$/, ""), capabilities, request);
  }

  async requestJson<T>(path: `/v1/${string}`, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.request(new URL(path, `${this.apiBaseUrl}/`), init);
    } catch {
      throw new StrykeSdkError(
        "source_unavailable",
        "API request could not be completed",
        true,
        { path }
      );
    }
    if (response.headers.get("Stryke-Api-Version") !== SUPPORTED_API_VERSION) {
      throw new StrykeSdkError("compatibility", "API response version changed");
    }
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string } }
      | undefined;
    if (!response.ok) {
      throw new StrykeSdkError(
        apiErrorCode(body?.error?.code),
        body?.error?.message ?? `API request failed with ${response.status}`,
        response.status >= 500,
        { status: response.status, path }
      );
    }
    return body as T;
  }
}
