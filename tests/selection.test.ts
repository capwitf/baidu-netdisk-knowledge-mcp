import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSelectionStore, parseSelectionExpression } from "../src/selection.js";

describe("selection workflow", () => {
  it("parses natural index selections like 1,3,5-7", () => {
    expect(parseSelectionExpression("1,3,5-7", 8)).toEqual([0, 2, 4, 5, 6]);
    expect(() => parseSelectionExpression("0,2", 3)).toThrow(/out of range/);
    expect(() => parseSelectionExpression("2-1", 3)).toThrow(/invalid range/);
  });

  it("stores a numbered result list and creates a reusable selectionId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-selection-"));
    try {
      const store = new FileSelectionStore(join(dir, "selections.json"));
      const listing = await store.saveResultList([
        { fsId: "101", path: "/apps/kb/a.md", filename: "a.md", size: 10, isdir: 0 },
        { fsId: "102", path: "/apps/kb/b.pdf", filename: "b.pdf", size: 20, isdir: 0 },
        { fsId: "103", path: "/apps/kb/c.docx", filename: "c.docx", size: 30, isdir: 0 }
      ]);

      expect(listing.items.map((item) => item.index)).toEqual([1, 2, 3]);

      const selection = await store.createSelectionFromIndexes(listing.resultId, "1,3");

      expect(selection.selectionId).toMatch(/^sel_/);
      expect(selection.items.map((item) => item.path)).toEqual([
        "/apps/kb/a.md",
        "/apps/kb/c.docx"
      ]);
      await expect(store.getSelection(selection.selectionId)).resolves.toMatchObject({
        selectionId: selection.selectionId,
        itemCount: 2
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
