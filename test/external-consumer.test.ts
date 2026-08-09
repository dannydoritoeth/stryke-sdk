import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;

describe("external SDK consumer", () => {
  it("installs the packed SDK and imports built JavaScript outside the workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stryke-sdk-consumer-"));
    try {
      const pack = JSON.parse(
        execFileSync("npm", ["pack", "-w", "@stryketrade/sdk", "--json"], {
          cwd: root,
          encoding: "utf8",
        })
      ) as Array<{ filename: string }>;
      const tarball = join(root, pack[0]!.filename);
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ private: true, type: "module" })
      );
      execFileSync(
        "npm",
        ["install", "--ignore-scripts", "--no-package-lock", tarball],
        { cwd: directory, stdio: "pipe" }
      );
      await writeFile(
        join(directory, "consumer.mjs"),
        'import { SDK_VERSION } from "@stryketrade/sdk"; process.stdout.write(SDK_VERSION);'
      );
      expect(
        execFileSync("node", ["consumer.mjs"], {
          cwd: directory,
          encoding: "utf8",
        })
      ).toBe("0.1.8");
      const installed = JSON.parse(
        await readFile(
          join(directory, "node_modules", "@stryketrade", "sdk", "package.json"),
          "utf8"
        )
      ) as { main: string };
      expect(installed.main).toBe("./dist/index.js");
      await rm(tarball);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
