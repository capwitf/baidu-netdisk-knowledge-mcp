import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  assertWritableRemotePath,
  resolveLocalPath
} from "../src/paths.js";

describe("path guards", () => {
  it("allows Baidu write paths only under /apps when strict app paths are enabled", () => {
    expect(() => assertWritableRemotePath("/apps/demo/a.txt", true)).not.toThrow();
    expect(() => assertWritableRemotePath("/music/a.txt", true)).toThrow(/\/apps/);
  });

  it("keeps local file access inside the configured local root", () => {
    const root = process.cwd();
    const inside = resolveLocalPath("downloads/a.txt", root);
    expect(inside).toBe(join(root, "downloads", "a.txt"));
    expect(() => resolveLocalPath("../outside.txt", root)).toThrow(/outside local root/);
  });
});
