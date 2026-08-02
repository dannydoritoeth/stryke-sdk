import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const expiries = ["five_minute", "fifteen_minute", "hourly"];
const assets = ["BTC", "SOL"];
const strategies = ["polymarket_early", "polymarket_late"];
if (!existsSync(".env")) throw new Error("Copy .env.example to .env and configure devnet before running the matrix");
for (const name of ["STRYKE_API_BASE_URL", "STRYKE_SOLANA_RPC_URL", "STRYKE_WALLET_ADAPTER_PATH"]) {
  if (!process.env[name]) throw new Error(`${name} is required before running the matrix`);
}
const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const requestedAsset = option("asset");
const requestedExpiry = option("expiry");
const requestedStrategy = option("strategy");
const withOpposingLiquidity = process.argv.includes("--with-opposing-liquidity");
const timeoutSeconds = Number(option("timeout-seconds") ?? "7200");
const paperTimeoutSeconds = Number(option("paper-timeout-seconds") ?? "90");
if (requestedAsset && !assets.includes(requestedAsset)) throw new Error("--asset must be BTC or SOL");
if (requestedExpiry && !expiries.includes(requestedExpiry)) throw new Error("--expiry is invalid");
if (requestedStrategy && !strategies.includes(requestedStrategy)) throw new Error("--strategy must be polymarket_early or polymarket_late");
if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 60) throw new Error("--timeout-seconds must be an integer >= 60");
if (!Number.isSafeInteger(paperTimeoutSeconds) || paperTimeoutSeconds < 30) throw new Error("--paper-timeout-seconds must be an integer >= 30");
if (withOpposingLiquidity && !process.env.STRYKE_LIQUIDITY_KEYPAIR_PATH) throw new Error("STRYKE_LIQUIDITY_KEYPAIR_PATH is required with --with-opposing-liquidity");

const cells = assets
  .filter((asset) => !requestedAsset || asset === requestedAsset)
  .flatMap((asset) => expiries
    .filter((expiry) => !requestedExpiry || expiry === requestedExpiry)
    .flatMap((expiry) => strategies
      .filter((strategy) => !requestedStrategy || strategy === requestedStrategy)
      .map((strategy) => ({ asset, expiry, strategy }))));
const revision = process.env.STRYKE_MATRIX_REVISION ?? "working-tree";
const runId = `bot-matrix-${new Date().toISOString().replaceAll(/[-:.]/g, "").replace("Z", "Z")}`;
const directory = resolve("artifacts/devnet-bot-matrix", runId);
await mkdir(directory, { recursive: true });

const runPaperFollowUp = ({ cellId, cellEnv, lines }) => new Promise((complete) => {
  const paper = spawn(process.execPath, ["--env-file-if-exists=.env", "examples/reference-bot/dist/cli.js", "--profile=paper"], {
    cwd: process.cwd(), env: cellEnv, stdio: ["ignore", "pipe", "pipe"],
  });
  let evaluated = false;
  const record = (stream, chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      lines.push({ observedAt: new Date().toISOString(), stream: `paper_${stream}`, line });
      process.stdout.write(`[${cellId}:paper] ${line}\n`);
      try {
        const event = JSON.parse(line);
        if (event.phase === "entry") {
          evaluated = true;
          paper.kill("SIGTERM");
        }
      } catch {}
    }
  };
  paper.stdout.on("data", (chunk) => record("stdout", chunk));
  paper.stderr.on("data", (chunk) => record("stderr", chunk));
  const timer = setTimeout(() => paper.kill("SIGTERM"), paperTimeoutSeconds * 1_000);
  paper.on("exit", () => {
    clearTimeout(timer);
    complete(evaluated);
  });
});

const seedOpposingLiquidity = ({ asset, expiry, strategy, marketId }) => new Promise((complete, reject) => {
  const cellId = `${asset.toLowerCase()}-${expiry}-${strategy}`;
  const child = spawn(process.execPath, ["scripts/devnet-seed-opposing-pool.mjs", "--asset", asset, "--expiry", expiry, "--amount-lamports", "1000000", ...(marketId ? ["--market-id", marketId] : []), "--i-approve-devnet-liquidity"], {
    cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); process.stdout.write(`[${cellId}:liquidity] ${chunk}`); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); process.stderr.write(`[${cellId}:liquidity] ${chunk}`); });
  child.on("exit", (code) => {
    if (code !== 0) reject(new Error(`Opposing liquidity failed for ${cellId}: ${stderr || stdout}`));
    else {
      const event = stdout.split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }).find((row) => row.event === "devnet_opposing_liquidity_seeded");
      complete(event);
    }
  });
});

const seedLateLiquidityWithRolloverRetry = async (cell) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return await seedOpposingLiquidity(cell); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Market rolled while seeding opposing liquidity") || attempt === 3) throw error;
      console.log(JSON.stringify({ event: "devnet_liquidity_rollover_retry", asset: cell.asset, expiry: cell.expiry, strategy: cell.strategy, attempt }));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    }
  }
  throw new Error("Unreachable liquidity rollover retry state");
};

const runCell = ({ asset, expiry, strategy }, attempt = 1) => new Promise((complete) => {
  const cellId = `${asset.toLowerCase()}-${expiry}-${strategy}`;
  const checkpoint = resolve(directory, `${cellId}.checkpoint.json`);
  const roundState = resolve(directory, `${cellId}.rounds.json`);
  const lines = [];
  const cellEnv = {
    ...process.env,
    STRYKE_ASSET: asset,
    STRYKE_EXPIRY_FAMILY: expiry,
    STRYKE_STRATEGY: strategy,
    STRYKE_POLY_EXIT_POLICY: strategy === "polymarket_late" ? "hold_to_expiry" : (process.env.STRYKE_POLY_EXIT_POLICY ?? "exit_on_convergence"),
    STRYKE_ESTIMATOR: "volatility_adjusted_probability",
    STRYKE_CHECKPOINT_PATH: checkpoint,
    STRYKE_ROUND_STATE_PATH: roundState,
  };
  const child = spawn(process.execPath, ["--env-file-if-exists=.env", "examples/reference-bot/dist/cli.js", "--profile=devnet"], {
    cwd: process.cwd(),
    env: cellEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const startedAt = new Date().toISOString();
  let buyTick;
  let completionActionId;
  let cleanLifecycle = false;
  let timedOut = false;
  let liquiditySeed;
  let liquiditySeedResult;
  let liquidityFailure;
  const record = (stream, chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      lines.push({ observedAt: new Date().toISOString(), stream, line });
      process.stdout.write(`[${cellId}] ${line}\n`);
      try {
        const event = JSON.parse(line);
        if (event.action === "buy" && event.signature && Number.isInteger(event.tick) && buyTick === undefined) {
          buyTick = event.tick;
          if (withOpposingLiquidity && strategy === "polymarket_early") {
            liquiditySeed = seedOpposingLiquidity({ asset, expiry, strategy, marketId: event.marketId })
              .then((seed) => { liquiditySeedResult = seed; })
              .catch((error) => {
                liquidityFailure = error instanceof Error ? error.message : String(error);
                child.kill("SIGTERM");
              });
          }
        }
        if (buyTick !== undefined && event.tick > buyTick && ["sell", "claim", "refund"].includes(event.action) && event.signature) completionActionId = event.clientActionId;
        if (completionActionId && event.phase === "reconcile" && event.action === "complete" && event.clientActionId === completionActionId) {
          cleanLifecycle = true;
          child.kill("SIGTERM");
        }
      } catch {}
    }
  };
  child.stdout.on("data", (chunk) => record("stdout", chunk));
  child.stderr.on("data", (chunk) => record("stderr", chunk));
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutSeconds * 1_000);
  child.on("exit", async (code, signal) => {
    clearTimeout(timer);
    if (liquiditySeed) await liquiditySeed;
    let nextMarketEvaluated = false;
    if (cleanLifecycle) {
      nextMarketEvaluated = await runPaperFollowUp({ cellId, cellEnv, lines });
    }
    const events = lines.flatMap(({ line }) => { try { return [JSON.parse(line)]; } catch { return []; } });
    const runtimeEvents = events.filter((event) => Number.isInteger(event.tick));
    const actions = runtimeEvents.filter((event) => ["buy", "sell", "claim", "refund"].includes(event.action));
    const buy = actions.find((event) => event.action === "buy" && event.signature);
    const completion = buy && actions.find((event) => event.tick > buy.tick && ["sell", "claim", "refund"].includes(event.action) && event.signature);
    const result = {
      schemaVersion: "stryke.referenceBotDevnetMatrixCell.v2", runId, revision, asset, expiry, strategy, attempt,
      startedAt, completedAt: new Date().toISOString(), exitCode: code, signal,
      timedOut, tickCount: runtimeEvents.length,
      actions, lifecycleCompleted: Boolean(completion) && cleanLifecycle, nextMarketEvaluated,
      ...(liquiditySeedResult ? { liquiditySeed: liquiditySeedResult } : {}),
      ...(liquidityFailure ? { liquidityFailure } : {}),
      checkpointPath: checkpoint, lines,
    };
    await writeFile(resolve(directory, `${cellId}.attempt-${attempt}.json`), `${JSON.stringify(result, null, 2)}\n`);
    complete(result);
  });
});

const safeRetryableInfrastructureFailure = (result) =>
  !result.timedOut &&
  !result.actions.some((event) => event.signature) &&
  result.lines.some(({ line }) => {
    try {
      const event = JSON.parse(line);
      return (event.event === "reference_bot_preflight" && event.status === "failed") ||
        (event.event === "reference_bot_error" && event.message === "fetch failed");
    } catch {
      return false;
    }
  });

const results = [];
const liquiditySeeds = [];
for (const cell of cells) {
  if (withOpposingLiquidity && cell.strategy === "polymarket_late") liquiditySeeds.push(await seedLateLiquidityWithRolloverRetry(cell));
  let result = await runCell(cell);
  if (safeRetryableInfrastructureFailure(result)) {
    console.log(JSON.stringify({ event: "devnet_bot_matrix_safe_retry", asset: cell.asset, expiry: cell.expiry, strategy: cell.strategy, delayMs: 5_000 }));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
    result = await runCell(cell, 2);
  }
  await writeFile(resolve(directory, `${cell.asset.toLowerCase()}-${cell.expiry}-${cell.strategy}.json`), `${JSON.stringify(result, null, 2)}\n`);
  if (result.liquiditySeed) liquiditySeeds.push(result.liquiditySeed);
  results.push(result);
  if (result.liquidityFailure || !result.lifecycleCompleted) {
    console.error(JSON.stringify({ event: "devnet_bot_matrix_stopped_after_incomplete_cell", asset: cell.asset, expiry: cell.expiry, strategy: cell.strategy, liquidityFailure: result.liquidityFailure }));
    break;
  }
}
const selectedSides = [...new Set(results.flatMap((result) => result.actions.filter((event) => event.action === "buy" && event.signature).map((event) => event.side)))].sort();
const completedByStrategy = Object.fromEntries(strategies.map((strategy) => [strategy, results.filter((result) => result.strategy === strategy && result.lifecycleCompleted).length]));
const report = { schemaVersion: "stryke.referenceBotDevnetMatrix.v2", runId, revision, generatedAt: new Date().toISOString(), withOpposingLiquidity, liquiditySeeds, selectedSides, completedByStrategy, results };
await writeFile(resolve(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ event: "devnet_bot_matrix_complete", runId, directory, cells: results.length }));
const completeCells = results.every((result) => result.tickCount >= 2 && result.actions.some((event) => event.action === "buy" && event.signature) && result.lifecycleCompleted && result.nextMarketEvaluated);
const strategyCyclesComplete = strategies.filter((strategy) => !requestedStrategy || strategy === requestedStrategy).every((strategy) => completedByStrategy[strategy] >= 2);
const bothSidesObserved = requestedAsset || requestedExpiry || requestedStrategy ? true : selectedSides.includes("yes") && selectedSides.includes("no");
process.exitCode = completeCells && strategyCyclesComplete && bothSidesObserved ? 0 : 1;
