import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const allowDirty = process.argv.includes("--allow-dirty");
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="))?.split("=", 2)[1];
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();

if (dirty && !allowDirty) {
  throw new Error("Refusing to produce release artifacts from a dirty working tree");
}

const releaseRoot = resolve(root, "artifacts", "release");
mkdirSync(releaseRoot, { recursive: true });
const outputDirectory = outputArgument
  ? resolve(root, outputArgument)
  : mkdtempSync(resolve(releaseRoot, `candidate-${commit.slice(0, 12)}-`));
if (outputArgument) {
  if (existsSync(outputDirectory)) throw new Error(`Artifact output already exists: ${outputDirectory}`);
  mkdirSync(outputDirectory, { recursive: true });
}

const pack = (packageName) => {
  const output = execFileSync(
    "npm",
    ["pack", "-w", packageName, "--pack-destination", outputDirectory, "--json", "--silent"],
    { cwd: root, encoding: "utf8" }
  );
  const packed = JSON.parse(output)[0];
  const artifactName = packageName === "@stryketrade/sdk" ? "stryke-sdk" : "stryke-reference-bot";
  const canonicalFilename = `${artifactName}-${packed.version}.tgz`;
  renameSync(resolve(outputDirectory, packed.filename), resolve(outputDirectory, canonicalFilename));
  return { ...packed, filename: canonicalFilename };
};

const sha512 = (path) => createHash("sha512").update(readFileSync(path)).digest("hex");
const consumerDirectory = mkdtempSync(resolve(tmpdir(), "stryke-release-consumer-"));

try {
  const sdk = pack("@stryketrade/sdk");
  const bot = pack("@stryketrade/reference-bot");
  const sdkTarball = resolve(outputDirectory, sdk.filename);
  const botTarball = resolve(outputDirectory, bot.filename);
  writeFileSync(resolve(consumerDirectory, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync("npm", ["install", "--no-package-lock", sdkTarball, botTarball], {
    cwd: consumerDirectory,
    stdio: "pipe",
  });
  const smoke = execFileSync(resolve(consumerDirectory, "node_modules", ".bin", "stryke-reference-bot"), [], {
    cwd: consumerDirectory,
    encoding: "utf8",
  });
  if (!smoke.includes('"event":"stryke_compatibility"') || (smoke.match(/"tick":/g) ?? []).length !== 2) {
    throw new Error("Packed reference bot clean-room smoke did not complete two ticks");
  }
  const doctor = spawnSync(resolve(consumerDirectory, "node_modules", ".bin", "stryke-reference-bot"), ["doctor", "--profile=paper"], {
    cwd: consumerDirectory,
    encoding: "utf8",
    env: { ...process.env, STRYKE_API_BASE_URL: "not-a-valid-url" },
  });
  if (doctor.status !== 1 || !doctor.stdout.includes('"event":"reference_bot_doctor"') || !doctor.stdout.includes('"status":"BLOCKED"')) {
    throw new Error("Packed reference bot doctor did not produce the stable blocked contract");
  }
  const manifest = {
    schemaVersion: "stryke.releaseArtifacts.v1",
    commit,
    dirty: Boolean(dirty),
    nodeVersion: process.version,
    packages: [sdk, bot].map((entry) => {
      const path = resolve(outputDirectory, entry.filename);
      return {
        name: entry.name,
        version: entry.version,
        file: basename(path),
        bytes: readFileSync(path).byteLength,
        sha512: sha512(path),
        npmIntegrity: entry.integrity,
      };
    }),
    verification: {
      cleanRoomInstall: "passed",
      referenceBotTicks: 2,
      doctorInvocation: "passed",
    },
  };
  const manifestPath = resolve(outputDirectory, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ outputDirectory, manifestPath, commit, packages: manifest.packages })}\n`);
} catch (error) {
  rmSync(outputDirectory, { recursive: true, force: true });
  throw error;
} finally {
  rmSync(consumerDirectory, { recursive: true, force: true });
}
