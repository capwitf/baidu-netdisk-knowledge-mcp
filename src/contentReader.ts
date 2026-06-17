import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import Papa from "papaparse";

export interface TextChunk {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface ParsedDocument {
  path: string;
  filename: string;
  kind: string;
  text: string;
  chunks: TextChunk[];
  metadata: {
    bytes: number;
    extension: string;
  };
}

export interface ParseOptions {
  chunkSize?: number;
}

const DEFAULT_CHUNK_SIZE = 6000;

export async function parseCachedDocument(
  filePath: string,
  options: ParseOptions = {}
): Promise<ParsedDocument> {
  const extension = extname(filePath).toLowerCase();
  const buffer = await readFile(filePath);
  const text = await parseBuffer(buffer, extension);
  return {
    path: filePath,
    filename: filePath.split(/[\\/]/).pop() ?? filePath,
    kind: kindFromExtension(extension),
    text,
    chunks: splitTextChunks(text, options.chunkSize ?? DEFAULT_CHUNK_SIZE),
    metadata: {
      bytes: buffer.byteLength,
      extension
    }
  };
}

export function splitTextChunks(text: string, chunkSize: number): TextChunk[] {
  if (chunkSize <= 0) throw new Error("chunkSize must be positive.");
  const chunks: TextChunk[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const hardEnd = Math.min(cursor + chunkSize, text.length);
    let end = hardEnd;
    if (hardEnd < text.length) {
      const window = text.slice(cursor, hardEnd + 1);
      const whitespace = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\n"));
      if (whitespace > 0) end = cursor + whitespace;
    }
    const chunkText = text.slice(cursor, end).trim();
    if (chunkText) {
      chunks.push({
        index: chunks.length + 1,
        start: cursor,
        end,
        text: chunkText
      });
    }
    cursor = end;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  }

  return chunks;
}

async function parseBuffer(buffer: Buffer, extension: string): Promise<string> {
  if ([".txt", ".md", ".markdown"].includes(extension)) {
    return buffer.toString("utf8");
  }
  if (extension === ".json") {
    return JSON.stringify(JSON.parse(buffer.toString("utf8")), null, 2);
  }
  if (extension === ".csv") {
    return csvToMarkdown(buffer.toString("utf8"));
  }
  if (extension === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed.text;
    } finally {
      await parser.destroy();
    }
  }
  if (extension === ".docx") {
    const mammoth = await import("mammoth");
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value;
  }
  throw new Error(`Unsupported document extension: ${extension}`);
}

function csvToMarkdown(text: string): string {
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: true
  });
  if (parsed.errors.length > 0) {
    throw new Error(`Could not parse CSV: ${parsed.errors[0].message}`);
  }
  const rows = parsed.data.map((row) => row.map(markdownCell));
  if (rows.length === 0) return "";
  const [header, ...body] = rows;
  return [
    header.join(" | "),
    header.map(() => "---").join(" | "),
    ...body.map((row) => row.join(" | "))
  ].join("\n");
}

function markdownCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function kindFromExtension(extension: string): string {
  switch (extension) {
    case ".md":
    case ".markdown":
      return "markdown";
    case ".txt":
      return "text";
    case ".json":
      return "json";
    case ".csv":
      return "csv";
    case ".pdf":
      return "pdf";
    case ".docx":
      return "docx";
    default:
      return "unknown";
  }
}
