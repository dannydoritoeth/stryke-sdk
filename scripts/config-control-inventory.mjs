const configEvidence = (title) => ({
  file: "examples/reference-bot/test/config.test.ts",
  title,
});
const runtimeEvidence = (title) => ({
  file: "examples/reference-bot/test/sdk-runtime.test.ts",
  title,
});
const entryEvidence = {
  file: "examples/reference-bot/test/entry.test.ts",
  title: "edge_impact_time_size_position_and_aggregate_caps_each_block_entry",
};

export const configControlInventory = {
  STRYKE_ASSET: { consumer: "SDK market discovery and Pyth selection", evidence: runtimeEvidence("actual_sdk_tick_consumes_market_side_size_slippage_estimator_and_risk_config") },
  STRYKE_EXPIRY_FAMILY: { consumer: "SDK market discovery", evidence: runtimeEvidence("actual_sdk_tick_consumes_market_side_size_slippage_estimator_and_risk_config") },
  STRYKE_SIDE: { consumer: "buy quote and decision side", evidence: runtimeEvidence("actual_sdk_tick_consumes_market_side_size_slippage_estimator_and_risk_config") },
  STRYKE_ESTIMATOR: { consumer: "entry and exit probability estimator", evidence: runtimeEvidence("actual_sdk_tick_consumes_market_side_size_slippage_estimator_and_risk_config") },
  STRYKE_TRADE_SIZE_SOL: { consumer: "buy quote amount", evidence: runtimeEvidence("actual_sdk_tick_consumes_market_side_size_slippage_estimator_and_risk_config") },
  STRYKE_MAXIMUM_TRADE_SIZE_SOL: { consumer: "entry size gate and devnet funding preflight", evidence: entryEvidence },
  STRYKE_MAXIMUM_AGGREGATE_EXPOSURE_SOL: { consumer: "entry aggregate exposure gate", evidence: entryEvidence },
  STRYKE_MINIMUM_ENTRY_EDGE_BPS: { consumer: "entry edge gate", evidence: entryEvidence },
  STRYKE_MAXIMUM_PRICE_IMPACT_BPS: { consumer: "quote slippage and entry impact gate", evidence: runtimeEvidence("actual_sdk_tick_consumes_market_side_size_slippage_estimator_and_risk_config") },
  STRYKE_MINIMUM_SECONDS_TO_EXPIRY: { consumer: "entry expiry-time gate", evidence: entryEvidence },
  STRYKE_MAXIMUM_OPEN_POSITIONS: { consumer: "entry position-cap gate", evidence: entryEvidence },
  STRYKE_TICK_INTERVAL_MS: { consumer: "recurring runtime wait", evidence: { file: "examples/reference-bot/test/reference-bot-runtime.test.ts", title: "runtime_tick_interval_reaches_the_recurring_wait_consumer" } },
  STRYKE_STOP_LOSS_BPS: { consumer: "position exit policy", evidence: { file: "examples/reference-bot/test/exit-policy.test.ts", title: "stop_loss_below_and_at_boundary_sells" } },
  STRYKE_TAKE_PROFIT_BPS: { consumer: "position exit policy", evidence: { file: "examples/reference-bot/test/exit-policy.test.ts", title: "take_profit_above_and_at_boundary_sells" } },
  STRYKE_PRICE_HISTORY_MAX_POINTS: { consumer: "Pyth history slice passed to estimator", evidence: runtimeEvidence("actual_sdk_tick_consumes_market_side_size_slippage_estimator_and_risk_config") },
  STRYKE_API_BASE_URL: { consumer: "StrykeClient connection", evidence: configEvidence("projects_connection_and_file_controls_into_the_cli_runtime_consumers") },
  STRYKE_SOLANA_RPC_URL: { consumer: "Solana RPC client", evidence: configEvidence("projects_connection_and_file_controls_into_the_cli_runtime_consumers") },
  STRYKE_PYTH_HERMES_URL: { consumer: "Pyth Hermes subscription", evidence: configEvidence("projects_connection_and_file_controls_into_the_cli_runtime_consumers") },
  STRYKE_CHECKPOINT_PATH: { consumer: "FileActionCheckpointStore", evidence: configEvidence("projects_connection_and_file_controls_into_the_cli_runtime_consumers") },
  STRYKE_WALLET_ADAPTER_PATH: { consumer: "devnet signer module loader", evidence: configEvidence("projects_connection_and_file_controls_into_the_cli_runtime_consumers") },
  STRYKE_WALLET_KEYPAIR_PATH: { consumer: "bundled wallet adapter keypair loader", evidence: { file: "test/wallet-adapter-errors.test.ts", title: "devnet_preflight_reports_unreadable_keypair_remediation" } },
  STRYKE_READ_ONLY_MODE: { consumer: "wallet and transaction safety precedence", evidence: configEvidence("paper_profile_overrides_unsafe_env_and_never_enables_transactions") },
  STRYKE_LIVE_TRADING_ENABLED: { consumer: "wallet and transaction safety precedence", evidence: configEvidence("paper_profile_overrides_unsafe_env_and_never_enables_transactions") },
  STRYKE_KILL_SWITCH_ENABLED: { consumer: "wallet and transaction safety precedence", evidence: configEvidence("kill_switch_overrides_live_enablement") },
};
