import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCachedDocument, splitTextChunks } from "../src/contentReader.js";

describe("content reader", () => {
  it("parses supported plain data formats and returns chunks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-reader-"));
    try {
      const markdownPath = join(dir, "note.md");
      const jsonPath = join(dir, "data.json");
      const csvPath = join(dir, "table.csv");
      await writeFile(markdownPath, "# MCP\n\nBuild knowledge tools.");
      await writeFile(jsonPath, JSON.stringify({ title: "Knowledge", tags: ["MCP"] }));
      await writeFile(csvPath, "name,note\nmcp,\"Model, Context Protocol\"\nnetdisk,2\n");

      await expect(parseCachedDocument(markdownPath, { chunkSize: 12 })).resolves.toMatchObject({
        kind: "markdown",
        text: "# MCP\n\nBuild knowledge tools.",
        chunks: [
          { index: 1, text: "# MCP\n\nBuild" },
          { index: 2, text: "knowledge" },
          { index: 3, text: "tools." }
        ]
      });
      await expect(parseCachedDocument(jsonPath)).resolves.toMatchObject({
        kind: "json",
        text: expect.stringContaining('"title": "Knowledge"')
      });
      await expect(parseCachedDocument(csvPath)).resolves.toMatchObject({
        kind: "csv",
        text: expect.stringContaining("mcp | Model, Context Protocol")
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("splits long text on whitespace without exceeding the requested chunk size when possible", () => {
    expect(splitTextChunks("alpha beta gamma delta", 11)).toEqual([
      { index: 1, start: 0, end: 10, text: "alpha beta" },
      { index: 2, start: 11, end: 22, text: "gamma delta" }
    ]);
  });
});
