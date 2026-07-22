import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { STRYKE_SDK_ERROR_CODES } from "../packages/sdk/src/index.js";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readme = read("README.md");
const quickstart = read("docs/quickstart.md");
const mechanics = read("docs/market-mechanics.md");
const configuration = read("docs/configuration.md");
const troubleshooting = read("docs/troubleshooting.md");
const publicDocs = [readme, quickstart, mechanics, configuration, troubleshooting].join("\n");

describe("pilot documentation contract", () => {
  it("readme_links_quickstart_and_market_mechanics", () => {
    expect(readme).toContain("[quickstart](docs/quickstart.md)");
    expect(readme).toContain("[market mechanics](docs/market-mechanics.md)");
  });

  it("quickstart_uses_btc_5m_and_labels_1m_experimental", () => {
    expect(quickstart).toMatch(/BTC five-minute.*canonical onboarding/is);
    expect(quickstart).toMatch(/one-minute live strategy performance is experimental/i);
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
    expect(readme).toContain("STRYKE_LIVE_TRADING_ENABLED=true");
  });

  it("docs_show_sdk_api_program_compatibility_output", () => {
    for (const field of ["sdkVersion", "apiVersion", "apiSchemaVersion", "programId", "programVersion"]) expect(quickstart).toContain(`\`${field}\``);
  });

  it("public_docs_do_not_leak_private_plans_paths_or_operations", () => {
    expect(publicDocs).not.toMatch(/stryke\.fun|PRD\s*\d+|docs\/prds|internal runbook|production credential/i);
  });
});
