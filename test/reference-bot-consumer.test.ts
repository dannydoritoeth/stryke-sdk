import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;

type PackResult = { filename: string; integrity: string; files: Array<{ path: string }> };

const pack = (packageName: string, destination: string): PackResult =>
  (JSON.parse(execFileSync("npm", ["pack", "-w", packageName, "--pack-destination", destination, "--json"], {
    cwd: root,
    encoding: "utf8",
  })) as PackResult[])[0]!;

describe("external reference-bot consumer", () => {
  it("installs and runs immutable packed SDK and bot artifacts outside the workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stryke-reference-bot-consumer-"));
    const sdk = pack("@stryke/sdk", directory);
    const bot = pack("@stryke/reference-bot", directory);
    const sdkTarball = join(directory, sdk.filename);
    const botTarball = join(directory, bot.filename);
    try {
      expect(sdk.integrity).toMatch(/^sha512-/);
      expect(bot.integrity).toMatch(/^sha512-/);
      expect(bot.files.some(({ path }) => path.startsWith("dist/"))).toBe(true);
      expect(bot.files.some(({ path }) => path.startsWith("src/") || path.startsWith("test/"))).toBe(false);
      await writeFile(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
      execFileSync(
        "npm",
        ["install", "--no-package-lock", sdkTarball, botTarball],
        { cwd: directory, stdio: "pipe" }
      );
      const manifest = JSON.parse(await readFile(join(directory, "node_modules", "@stryke", "reference-bot", "package.json"), "utf8")) as { bin: Record<string, string>; main: string };
      expect(manifest).toMatchObject({ main: "./dist/bot.js", bin: { "stryke-reference-bot": "./dist/cli.js" } });
      const output = execFileSync(join(directory, "node_modules", ".bin", "stryke-reference-bot"), [], { cwd: directory, encoding: "utf8" });
      expect(output).toContain('"event":"stryke_compatibility"');
      expect(output.match(/"tick":/g)).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
