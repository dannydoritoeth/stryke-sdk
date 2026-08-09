import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;

describe("external reference-bot consumer", () => {
  it("installs and runs immutable packed SDK and bot artifacts outside the workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stryke-reference-bot-consumer-"));
    const output = join(directory, "release");
    try {
      execFileSync("node", ["scripts/pack-release-artifacts.mjs", "--allow-dirty", `--output=${output}`], { cwd: root, stdio: "pipe" });
      const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as {
        schemaVersion: string;
        commit: string;
        packages: Array<{ name: string; file: string; sha512: string; npmIntegrity: string }>;
        verification: { cleanRoomInstall: string; referenceBotTicks: number; doctorInvocation: string };
      };
      expect(manifest.schemaVersion).toBe("stryke.releaseArtifacts.v1");
      expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(manifest.packages.map(({ name }) => name)).toEqual(["@stryketrade/sdk", "@stryketrade/reference-bot"]);
      for (const entry of manifest.packages) {
        expect(entry.sha512).toMatch(/^[0-9a-f]{128}$/);
        expect(entry.npmIntegrity).toMatch(/^sha512-/);
        expect(await readFile(join(output, entry.file))).not.toHaveLength(0);
      }
      expect(manifest.verification).toEqual({ cleanRoomInstall: "passed", referenceBotTicks: 2, doctorInvocation: "passed" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
