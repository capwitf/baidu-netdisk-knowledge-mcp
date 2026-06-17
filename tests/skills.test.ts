import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSkillRegistry, runSkill } from "../src/skills.js";

describe("knowledge skills", () => {
  it("loads built-in and custom markdown/yaml skills", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-skills-"));
    try {
      await writeFile(
        join(dir, "custom-cleanup.md"),
        [
          "---",
          "name: custom-cleanup",
          "description: Custom cleanup template",
          "category: organizer",
          "---",
          "Group by project and remove duplicates."
        ].join("\n")
      );
      await writeFile(
        join(dir, "course-notes.yaml"),
        [
          "name: course-notes",
          "description: Course note template",
          "category: study",
          "template: Extract lectures, concepts, and homework."
        ].join("\n")
      );

      const registry = new FileSkillRegistry({
        userSkillsDir: dir,
        builtInSkillsDir: join(process.cwd(), "skills")
      });
      const skills = await registry.listSkills();

      expect(skills.map((skill) => skill.name)).toEqual(
        expect.arrayContaining(["knowledge-notes", "custom-cleanup", "course-notes"])
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("runs the knowledge-notes skill into structured notes and a safe folder suggestion", async () => {
    const result = runSkill(
      {
        name: "knowledge-notes",
        description: "Knowledge notes",
        category: "knowledge",
        template: "Extract reusable knowledge.",
        outputSchema: "knowledge-note"
      },
      [
        {
          filename: "mcp.md",
          path: "/apps/kb/mcp.md",
          text: "# MCP\nModel Context Protocol connects tools to AI.\nTODO: build selector.",
          chunks: []
        }
      ]
    );

    expect(result.note).toMatchObject({
      title: "MCP",
      category: "AI",
      tags: expect.arrayContaining(["MCP", "知识管理"]),
      suggestedFolder: "/apps/知识库/AI/MCP"
    });
    expect(result.note.keyPoints[0]).toContain("Model Context Protocol");
    expect(result.note.actionItems[0]).toContain("build selector");
  });
});
