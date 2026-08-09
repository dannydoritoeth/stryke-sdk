import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workspace = new URL("..", import.meta.url).pathname;
const json = (path: string) => JSON.parse(readFileSync(join(workspace, path), "utf8")) as Record<string, any>;

describe("npm publication contract", () => {
  const sdk = json("packages/sdk/package.json");
  const bot = json("examples/reference-bot/package.json");
  const workflow = readFileSync(join(workspace, ".github/workflows/publish-npm.yml"), "utf8");

  it("publishes both packages publicly from the exact public repository", () => {
    for (const manifest of [sdk, bot]) {
      expect(manifest.private).not.toBe(true);
      expect(manifest.publishConfig).toEqual({ access: "public" });
      expect(manifest.repository.url).toBe("git+https://github.com/dannydoritoeth/stryke-sdk.git");
    }
    expect(bot.version).toBe(sdk.version);
    expect(bot.dependencies["@stryke/sdk"]).toBe(sdk.version);
  });

  it("requires an immutable matching tag and verifies clean registry consumers", () => {
    expect(workflow).toContain('test "$GITHUB_REF_TYPE" = "tag"');
    expect(workflow).toContain('test "$GITHUB_REF_NAME" = "npm-v${sdk_version}"');
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("environment: npm-production");
    expect(workflow).toContain("npm publish -w @stryke/sdk --access public");
    expect(workflow).toContain("npm publish -w @stryke/reference-bot --access public");
    expect(workflow).toContain('npm install "@stryke/sdk@$version" "@stryke/reference-bot@$version"');
    expect(workflow).toContain("npx --no-install stryke-reference-bot");
  });
});
