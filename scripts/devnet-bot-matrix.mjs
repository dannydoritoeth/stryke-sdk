import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const expiries = ["one_minute", "five_minute", "fifteen_minute", "hourly"];
const assets = ["BTC", "SOL"];
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
const timeoutSeconds = Number(option("timeout-seconds") ?? "7200");
if (requestedAsset && !assets.includes(requestedAsset)) throw new Error("--asset must be BTC or SOL");
if (requestedExpiry && !expiries.includes(requestedExpiry)) throw new Error("--expiry is invalid");
if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 60) throw new Error("--timeout-seconds must be an integer >= 60");

const cells = assets
  .filter((asset) => !requestedAsset || asset === requestedAsset)
  .flatMap((asset) => expiries.filter((expiry) => !requestedExpiry || expiry === requestedExpiry).map((expiry) => ({ asset, expiry })));
const revision = process.env.STRYKE_MATRIX_REVISION ?? "working-tree";
const runId = `bot-matrix-${new Date().toISOString().replaceAll(/[-:.]/g, "").replace("Z", "Z")}`;
const directory = resolve("artifacts/devnet-bot-matrix", runId);
await mkdir(directory, { recursive: true });

const runCell = ({ asset, expiry }) => new Promise((complete) => {
  const cellId = `${asset.toLowerCase()}-${expiry}`;
  const checkpoint = resolve(directory, `${cellId}.checkpoint.json`);
  const lines = [];
  const cellEnv = {
    ...process.env,
    STRYKE_ASSET: asset,
    STRYKE_EXPIRY_FAMILY: expiry,
    ...(expiry === "one_minute" ? { STRYKE_MINIMUM_SECONDS_TO_EXPIRY: process.env.STRYKE_MATRIX_ONE_MINUTE_MINIMUM_SECONDS ?? "5" } : {}),
    STRYKE_CHECKPOINT_PATH: checkpoint,
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
  const record = (stream, chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      lines.push({ observedAt: new Date().toISOString(), stream, line });
      process.stdout.write(`[${cellId}] ${line}\n`);
      try {
        const event = JSON.parse(line);
        if (event.action === "buy" && event.signature && Number.isInteger(event.tick) && buyTick === undefined) buyTick = event.tick;
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
    let nextMarketEvaluated = false;
    if (cleanLifecycle) {
      const paper = spawnSync(process.execPath, ["--env-file-if-exists=.env", "examples/reference-bot/dist/cli.js", "--profile=paper", "--once"], {
        cwd: process.cwd(), env: cellEnv, encoding: "utf8", timeout: 60_000,
      });
      for (const [stream, output] of [["stdout", paper.stdout], ["stderr", paper.stderr]]) {
        for (const line of String(output ?? "").split("\n").filter(Boolean)) {
          lines.push({ observedAt: new Date().toISOString(), stream: `paper_${stream}`, line });
          process.stdout.write(`[${cellId}:paper] ${line}\n`);
          try { const event = JSON.parse(line); if (event.phase === "entry") nextMarketEvaluated = true; } catch {}
        }
      }
    }
    const events = lines.flatMap(({ line }) => { try { return [JSON.parse(line)]; } catch { return []; } });
    const runtimeEvents = events.filter((event) => Number.isInteger(event.tick));
    const actions = runtimeEvents.filter((event) => ["buy", "sell", "claim", "refund"].includes(event.action));
    const buy = actions.find((event) => event.action === "buy" && event.signature);
    const completion = buy && actions.find((event) => event.tick > buy.tick && ["sell", "claim", "refund"].includes(event.action) && event.signature);
    const result = {
      schemaVersion: "stryke.referenceBotDevnetMatrixCell.v1", runId, revision, asset, expiry,
      startedAt, completedAt: new Date().toISOString(), exitCode: code, signal,
      timedOut, tickCount: runtimeEvents.length,
      actions, lifecycleCompleted: Boolean(completion) && cleanLifecycle, nextMarketEvaluated,
      checkpointPath: checkpoint, lines,
    };
    await writeFile(resolve(directory, `${cellId}.json`), `${JSON.stringify(result, null, 2)}\n`);
    complete(result);
  });
});

const results = [];
for (const cell of cells) results.push(await runCell(cell));
const report = { schemaVersion: "stryke.referenceBotDevnetMatrix.v1", runId, revision, generatedAt: new Date().toISOString(), results };
await writeFile(resolve(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ event: "devnet_bot_matrix_complete", runId, directory, cells: results.length }));
process.exitCode = results.every((result) => result.tickCount >= 2 && result.actions.some((event) => event.action === "buy" && event.signature) && result.lifecycleCompleted && result.nextMarketEvaluated) ? 0 : 1;
