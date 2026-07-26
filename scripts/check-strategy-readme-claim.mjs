import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const claim = "The reference bot includes a volatility- and time-adjusted baseline that evaluates both sides against executable Stryke pricing and understands the fee-free activation region. It is intended as a credible starting point, not a guaranteed profitable strategy.";
const readme = readFileSync("README.md", "utf8").replaceAll(/\s+/g, " ");
const path = "docs/evidence/reference-bot-strategy-claim.json";
const present = readme.includes(claim);
if (!present) {
  console.log("Strategy README claim is not yet published; evidence gate remains closed.");
  process.exit(0);
}
if (!existsSync(path)) throw new Error(`README strategy claim requires ${path}`);
const evidence = JSON.parse(readFileSync(path, "utf8"));
if (evidence.schemaVersion !== "stryke.referenceBotStrategyClaim.v1" || evidence.status !== "passed") throw new Error("README strategy claim evidence is incomplete");
const required = ["BTC:one_minute", "BTC:five_minute", "BTC:fifteen_minute", "BTC:hourly", "SOL:one_minute", "SOL:five_minute", "SOL:fifteen_minute", "SOL:hourly"];
for (const cell of required) if (evidence.devnet?.[cell]?.status !== "passed") throw new Error(`README strategy claim missing devnet cell ${cell}`);
if (!evidence.composition?.multiIteration || !evidence.composition?.restart || !evidence.composition?.configurationConsumers) throw new Error("README strategy claim missing composition evidence");
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
execFileSync("git", ["merge-base", "--is-ancestor", evidence.implementationCommit, head]);
const changed = execFileSync("git", ["diff", "--name-only", `${evidence.implementationCommit}..${head}`, "--", "examples/reference-bot/src", "packages/sdk/src"], { encoding: "utf8" }).trim();
if (changed) throw new Error(`Strategy code changed after evidence commit:\n${changed}`);
console.log(`Strategy README claim evidence passed at ${evidence.implementationCommit}.`);
