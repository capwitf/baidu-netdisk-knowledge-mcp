import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { parse as parseYaml } from "yaml";

export interface KnowledgeSkill {
  name: string;
  description: string;
  category: string;
  template: string;
  outputSchema?: string;
}

export interface SkillInputDocument {
  filename: string;
  path: string;
  text: string;
  chunks: Array<{ index: number; text: string }>;
}

export interface KnowledgeNote {
  title: string;
  category: string;
  tags: string[];
  summary: string;
  keyPoints: string[];
  questions: string[];
  actionItems: string[];
  suggestedFolder: string;
}

export class FileSkillRegistry {
  constructor(
    private readonly options: {
      userSkillsDir: string;
      builtInSkillsDir: string;
    }
  ) {}

  async listSkills(): Promise<KnowledgeSkill[]> {
    const skills = [
      ...(await this.loadSkillsFromDir(this.options.builtInSkillsDir)),
      ...(await this.loadSkillsFromDir(this.options.userSkillsDir))
    ];
    return dedupeByName(skills).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getSkill(name: string): Promise<KnowledgeSkill> {
    const skill = (await this.listSkills()).find((entry) => entry.name === name);
    if (!skill) throw new Error(`Unknown skill: ${name}`);
    return skill;
  }

  private async loadSkillsFromDir(dir: string): Promise<KnowledgeSkill[]> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }

    const skills: KnowledgeSkill[] = [];
    for (const entry of entries) {
      const path = join(dir, entry);
      const ext = extname(entry).toLowerCase();
      if (ext === ".md" || ext === ".markdown") {
        skills.push(parseMarkdownSkill(await readFile(path, "utf8"), entry));
      } else if (ext === ".yaml" || ext === ".yml") {
        skills.push(normalizeSkill(parseYaml(await readFile(path, "utf8")), entry));
      }
    }
    return skills;
  }
}

export function runSkill(
  skill: KnowledgeSkill,
  documents: SkillInputDocument[]
): {
  skill: string;
  note: KnowledgeNote;
  prompt: string;
} {
  const text = documents.map((document) => document.text).join("\n\n");
  const title = inferTitle(documents[0]?.filename ?? "Untitled", text);
  const category = inferCategory(text);
  const tags = inferTags(text);
  const keyPoints = extractKeyPoints(text);
  const actionItems = extractActionItems(text);
  const note: KnowledgeNote = {
    title,
    category,
    tags,
    summary: summarize(text),
    keyPoints,
    questions: extractQuestions(text),
    actionItems,
    suggestedFolder: `/apps/知识库/${category}/${slugFolder(title)}`
  };

  return {
    skill: skill.name,
    note,
    prompt: [
      `Skill: ${skill.name}`,
      skill.template,
      "",
      "Documents:",
      ...documents.map((document) => `- ${document.path}`)
    ].join("\n")
  };
}

function parseMarkdownSkill(raw: string, filename: string): KnowledgeSkill {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return {
      name: filename.replace(/\.(md|markdown)$/i, ""),
      description: filename,
      category: "custom",
      template: raw.trim()
    };
  }
  const meta = parseYaml(match[1]) as Record<string, unknown>;
  return normalizeSkill({ ...meta, template: match[2].trim() }, filename);
}

function normalizeSkill(raw: unknown, filename: string): KnowledgeSkill {
  const data = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const fallbackName = filename.replace(/\.(md|markdown|ya?ml)$/i, "");
  return {
    name: stringOr(data.name, fallbackName),
    description: stringOr(data.description, fallbackName),
    category: stringOr(data.category, "custom"),
    template: stringOr(data.template, ""),
    outputSchema: typeof data.outputSchema === "string" ? data.outputSchema : undefined
  };
}

function dedupeByName(skills: KnowledgeSkill[]): KnowledgeSkill[] {
  const byName = new Map<string, KnowledgeSkill>();
  for (const skill of skills) byName.set(skill.name, skill);
  return [...byName.values()];
}

function inferTitle(filename: string, text: string): string {
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return filename.replace(/\.[^.]+$/, "");
}

function inferCategory(text: string): string {
  if (/MCP|AI|LLM|模型|人工智能/i.test(text)) return "AI";
  if (/代码|编程|TypeScript|Python|API/i.test(text)) return "编程";
  if (/产品|用户|需求|PRD/i.test(text)) return "产品";
  if (/写作|文章|标题/i.test(text)) return "写作";
  return "知识";
}

function inferTags(text: string): string[] {
  const tags = new Set<string>(["知识管理"]);
  if (/MCP/i.test(text)) tags.add("MCP");
  if (/AI|LLM|模型|人工智能/i.test(text)) tags.add("AI");
  if (/百度|网盘/i.test(text)) tags.add("百度网盘");
  return [...tags];
}

function extractKeyPoints(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !/^todo[:：]/i.test(line))
    .slice(0, 8);
}

function extractQuestions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("?") || line.includes("？"))
    .slice(0, 8);
}

function extractActionItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^todo[:：]/i.test(line) || /^\[[ x]\]/i.test(line))
    .map((line) => line.replace(/^todo[:：]\s*/i, "").replace(/^\[[ x]\]\s*/i, ""))
    .slice(0, 8);
}

function summarize(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 280);
}

function slugFolder(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "").trim() || "未命名";
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
