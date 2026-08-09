import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { STRYKE_SDK_ERROR_CODES } from "../packages/sdk/src/index.js";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readme = read("README.md");
const sdkReadme = read("packages/sdk/README.md");
const botReadme = read("examples/reference-bot/README.md");
const quickstart = read("docs/quickstart.md");
const mechanics = read("docs/market-mechanics.md");
const configuration = read("docs/configuration.md");
const troubleshooting = read("docs/troubleshooting.md");
const publicDocs = [readme, sdkReadme, quickstart, mechanics, configuration, troubleshooting].join("\n");

describe("pilot documentation contract", () => {
  it("readme_links_quickstart_and_market_mechanics", () => {
    expect(readme).toContain("[quickstart](docs/quickstart.md)");
    expect(readme).toContain("[market mechanics](docs/market-mechanics.md)");
  });

  it("sdk_readme_gives_a_minimal_copyable_developer_path", () => {
    for (const phrase of [
      "npm install @stryketrade/sdk",
      "StrykeClient.connect",
      "MarketsClient",
      "QuotesClient",
      "TransactionsClient",
      "PositionsClient",
      "stryke-reference-bot --profile=paper",
      "mainnet",
    ]) {
      expect(sdkReadme).toContain(phrase);
    }
  });

  it("quickstart_uses_btc_5m_and_labels_1m_experimental", () => {
    expect(quickstart).toMatch(/BTC five-minute.*canonical onboarding/is);
    expect(quickstart).toMatch(/one-minute live automation is\s+experimental/i);
  });

  it("quickstart_creates_funds_and_protects_a_dedicated_trading_wallet", () => {
    expect(quickstart).toContain("solana-keygen new --outfile ../stryke-trading-wallet.json");
    expect(quickstart).toContain("solana-keygen pubkey ../stryke-trading-wallet.json");
    expect(quickstart).toContain("STRYKE_WALLET_KEYPAIR_PATH=\"$PWD/../stryke-trading-wallet.json\"");
    expect(quickstart).toMatch(/JSON file contains.*private key material/is);
    expect(quickstart).toMatch(/never commit or share.*personal wallet/is);
  });

  it("startup_failures_have_ai_readable_remediation", () => {
    expect(troubleshooting).toContain("reference_bot_preflight");
    for (const check of ["environment", "api", "pyth", "wallet", "rpc", "funding"]) {
      expect(troubleshooting).toContain(`\`${check}\``);
    }
    expect(troubleshooting).toContain("first `reference_bot_preflight` line");
  });

  it("docs_define_strike_time_resolution_equality_and_refund_semantics", () => {
    for (const phrase of ["target_value", "Solana Clock", "prev_publish_time < expiry_ts <= publish_time", "underfunded", "zero-winner"]) expect(mechanics).toContain(phrase);
    expect(mechanics).toMatch(/Equality\s+resolves NO/);
  });

  it("docs_define_quote_state_blockhash_and_minimum_output_validity", () => {
    for (const phrase of ["market-state version", "minimum output", "recent blockhash", "last-valid-block-height", "signature is evidence of submission, not confirmation"]) expect(mechanics.toLowerCase()).toContain(phrase.toLowerCase());
  });

  it("docs_define_action_reconciliation_and_restart_unknown_behavior", () => {
    expect(mechanics).toMatch(/On restart, reconcile before\s+retrying/);
    expect(mechanics).toMatch(/`submitted` and `unknown` block duplicate/);
  });

  it("docs_list_every_typed_error_and_recovery_precondition", () => {
    for (const code of STRYKE_SDK_ERROR_CODES) expect(troubleshooting).toContain(`\`${code}\``);
    expect(troubleshooting).toMatch(/Recovery precondition/);
  });

  it("docs_show_read_only_live_and_kill_switch_precedence", () => {
    expect(configuration).toMatch(/readOnlyMode.*Overrides live enablement/);
    expect(configuration).toMatch(/killSwitchEnabled.*Overrides live enablement/);
    expect(readme).toContain("npx stryke-reference-bot --profile=paper");
    expect(readme).toContain("npx stryke-reference-bot --profile=live");
    expect(readme).toMatch(/mainnet.*safety gate/is);
  });

  it("docs_show_sdk_api_program_compatibility_output", () => {
    for (const field of ["sdkVersion", "apiVersion", "apiSchemaVersion", "programId", "programVersion"]) expect(quickstart).toContain(`\`${field}\``);
  });

  it("readme_prioritizes_public_paper_then_live_onboarding", () => {
    expect(readme).toContain("npm install @stryketrade/sdk @stryketrade/reference-bot");
    expect(readme).toContain("npx stryke-reference-bot doctor --profile=paper");
    expect(readme).toContain("npx stryke-reference-bot --profile=paper");
    expect(readme).toContain("npx stryke-reference-bot doctor --profile=live");
    expect(readme).toContain("npx stryke-reference-bot --profile=live");
    expect(readme.indexOf("--profile=paper")).toBeLessThan(readme.indexOf("--profile=live"));
  });

  it("published_bot_readme_contains_the_complete_live_delta", () => {
    for (const phrase of [
      "solana-keygen new --outfile ../stryke-trading-wallet.json",
      "STRYKE_WALLET_ADAPTER_PATH",
      "wallet-adapter.example.mjs",
      "STRYKE_WALLET_KEYPAIR_PATH",
      "npx stryke-reference-bot doctor --profile=live",
      "npx stryke-reference-bot --profile=live",
      "No `.env` or additional live-enable variable is required",
      "insufficient_funding",
    ]) expect(botReadme).toContain(phrase);
    expect(botReadme).toMatch(/`:SOL:` because SOL\s+is the collateral asset/i);
  });

  it("public_docs_do_not_leak_private_plans_paths_or_operations", () => {
    expect(publicDocs).not.toMatch(/stryke\.fun|PRD\s*\d+|docs\/prds|internal runbook|production credential|candidate evidence|historical evidence/i);
  });
});
