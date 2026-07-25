import fs from "node:fs";
import path from "node:path";

import { configControlInventory } from "./config-control-inventory.mjs";

const root = process.cwd();
const errors = [];
const registered = new Set(Object.keys(configControlInventory));
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const configurationDoc = fs.readFileSync(path.join(root, "docs/configuration.md"), "utf8");
const documented = new Set([
  ...envExample.matchAll(/^(STRYKE_[A-Z0-9_]+)=/gm),
  ...configurationDoc.matchAll(/`(STRYKE_[A-Z0-9_]+)`/g),
].map((match) => match[1]));

for (const name of documented) {
  if (!registered.has(name)) errors.push(`${name}: documented but not registered`);
}
for (const [name, row] of Object.entries(configControlInventory)) {
  if (!row.consumer || row.consumer.length < 8) errors.push(`${name}: missing final consumer`);
  const absolute = path.join(root, row.evidence.file);
  if (!fs.existsSync(absolute)) {
    errors.push(`${name}: evidence file missing: ${row.evidence.file}`);
    continue;
  }
  const source = fs.readFileSync(absolute, "utf8");
  if (!source.includes(`it("${row.evidence.title}"`)) {
    errors.push(`${name}: exact evidence title missing: ${row.evidence.title}`);
  }
}

console.log(`Reference bot config register: ${registered.size} controls, ${errors.length} open gaps`);
for (const error of errors) console.error(`- ${error}`);
if (errors.length) process.exit(1);
