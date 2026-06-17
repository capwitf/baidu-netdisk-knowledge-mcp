import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface SelectableFile {
  fsId: string;
  path: string;
  filename: string;
  size?: number;
  isdir?: number;
  category?: number;
  md5?: string;
}

export interface NumberedSelectableFile extends SelectableFile {
  index: number;
}

export interface SelectionResultList {
  resultId: string;
  createdAt: string;
  itemCount: number;
  items: NumberedSelectableFile[];
}

export interface FileSelection {
  selectionId: string;
  createdAt: string;
  itemCount: number;
  items: NumberedSelectableFile[];
}

interface SelectionStoreData {
  resultLists: Record<string, SelectionResultList>;
  selections: Record<string, FileSelection>;
}

export class FileSelectionStore {
  constructor(private readonly path: string) {}

  async saveResultList(files: SelectableFile[]): Promise<SelectionResultList> {
    const data = await this.loadData();
    const resultList: SelectionResultList = {
      resultId: makeId("res"),
      createdAt: new Date().toISOString(),
      itemCount: files.length,
      items: files.map((file, index) => ({ ...file, index: index + 1 }))
    };
    data.resultLists[resultList.resultId] = resultList;
    await this.saveData(data);
    return resultList;
  }

  async createSelection(items: SelectableFile[]): Promise<FileSelection> {
    const data = await this.loadData();
    const selection: FileSelection = {
      selectionId: makeId("sel"),
      createdAt: new Date().toISOString(),
      itemCount: items.length,
      items: items.map((item, index) => ({
        ...item,
        index: "index" in item && typeof item.index === "number" ? item.index : index + 1
      }))
    };
    data.selections[selection.selectionId] = selection;
    await this.saveData(data);
    return selection;
  }

  async createSelectionFromIndexes(
    resultId: string,
    expression: string
  ): Promise<FileSelection> {
    const data = await this.loadData();
    const resultList = data.resultLists[resultId];
    if (!resultList) {
      throw new Error(`Unknown selectable resultId: ${resultId}`);
    }
    const indexes = parseSelectionExpression(expression, resultList.items.length);
    return this.createSelection(indexes.map((index) => resultList.items[index]));
  }

  async getResultList(resultId: string): Promise<SelectionResultList> {
    const data = await this.loadData();
    const resultList = data.resultLists[resultId];
    if (!resultList) throw new Error(`Unknown selectable resultId: ${resultId}`);
    return resultList;
  }

  async getSelection(selectionId: string): Promise<FileSelection> {
    const data = await this.loadData();
    const selection = data.selections[selectionId];
    if (!selection) throw new Error(`Unknown selectionId: ${selectionId}`);
    return selection;
  }

  private async loadData(): Promise<SelectionStoreData> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as SelectionStoreData;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { resultLists: {}, selections: {} };
      }
      throw error;
    }
  }

  private async saveData(data: SelectionStoreData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600
    });
  }
}

export function parseSelectionExpression(expression: string, itemCount: number): number[] {
  const indexes = new Set<number>();
  for (const rawPart of expression.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.includes("-")) {
      const [startRaw, endRaw] = part.split("-").map((value) => value.trim());
      const start = parseHumanIndex(startRaw, itemCount);
      const end = parseHumanIndex(endRaw, itemCount);
      if (start > end) throw new Error(`invalid range: ${part}`);
      for (let index = start; index <= end; index += 1) indexes.add(index);
    } else {
      indexes.add(parseHumanIndex(part, itemCount));
    }
  }

  if (indexes.size === 0) throw new Error("Selection expression did not select any files.");
  return [...indexes].sort((a, b) => a - b);
}

export function selectableFromBaiduEntry(entry: Record<string, unknown>): SelectableFile {
  const fsId = entry.fs_id ?? entry.fsId;
  const filename = entry.server_filename ?? entry.filename;
  if (fsId === undefined) throw new Error("Baidu file entry is missing fs_id.");
  if (typeof entry.path !== "string") throw new Error("Baidu file entry is missing path.");
  if (typeof filename !== "string") throw new Error("Baidu file entry is missing server_filename.");
  return {
    fsId: String(fsId),
    path: entry.path,
    filename,
    size: typeof entry.size === "number" ? entry.size : undefined,
    isdir: typeof entry.isdir === "number" ? entry.isdir : undefined,
    category: typeof entry.category === "number" ? entry.category : undefined,
    md5: typeof entry.md5 === "string" ? entry.md5 : undefined
  };
}

function parseHumanIndex(value: string | undefined, itemCount: number): number {
  if (!value || !/^\d+$/.test(value)) throw new Error(`Invalid selection index: ${value ?? ""}`);
  const humanIndex = Number(value);
  if (!Number.isInteger(humanIndex) || humanIndex < 1 || humanIndex > itemCount) {
    throw new Error(`Selection index out of range: ${value}`);
  }
  return humanIndex - 1;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
