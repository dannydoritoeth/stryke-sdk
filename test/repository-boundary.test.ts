import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const forbidden = [
  ["apps", "private-bot"].join("/"),
  ["work", "space:"].join(""),
  ["file:", "../"].join(""),
];
const forbiddenDependencyProtocols = new RegExp(
  `^(?:${["file", ["work", "space"].join(""), "link"].join("|")}):`
);

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(json|md|ts)$/.test(entry.name)) files.push(path);
  }
  return files;
};

describe("public repository boundary", () => {
  it("contains no private workspace dependency or path", async () => {
    for (const file of await sourceFiles(root)) {
      const text = await readFile(file, "utf8");
      for (const token of forbidden) {
        expect(text, `${relative(root, file)} contains ${token}`).not.toContain(token);
      }
    }
  });

  it("package dependencies resolve without repository-external protocols", async () => {
    for (const packagePath of [
      "packages/sdk/package.json",
      "examples/reference-bot/package.json",
    ]) {
      const packageJson = JSON.parse(await readFile(join(root, packagePath), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const [name, version] of Object.entries({
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      })) {
        expect(version, `${packagePath}: ${name}`).not.toMatch(
          forbiddenDependencyProtocols
        );
      }
    }
  });

  it("reference bot imports Stryke integration only through SDK exports", async () => {
    const files = await sourceFiles(join(root, "examples", "reference-bot", "src"));
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map(
        (match) => match[1]
      );
      expect(imports.filter((path) => path.includes("stryke"))).toEqual(
        imports.filter((path) => path === "@stryketrade/sdk")
      );
    }
  });

  it("built package contains JavaScript, declarations, and intended files only", async () => {
    const packageJson = JSON.parse(
      await readFile(join(root, "packages", "sdk", "package.json"), "utf8")
    ) as { main: string; types: string; files: string[] };
    expect(packageJson).toMatchObject({
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      files: ["dist", "README.md"],
    });
    const dist = await readdir(join(root, "packages", "sdk", "dist"), {
      recursive: true,
    });
    expect(dist).toContain("index.js");
    expect(dist).toContain("index.d.ts");
    expect(dist.some((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))).toBe(false);
  });
});
