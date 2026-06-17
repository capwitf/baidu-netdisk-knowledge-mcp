import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export type OperationStatus = "executed";

export interface OperationLogRecordInput {
  operation: string;
  paths: string[];
  status: OperationStatus;
  request?: unknown;
  response?: unknown;
}

export interface OperationLogRecord extends OperationLogRecordInput {
  id: string;
  timestamp: string;
}

export interface OperationLogger {
  record(input: OperationLogRecordInput): Promise<OperationLogRecord>;
  recent(limit?: number): Promise<OperationLogRecord[]>;
}

export interface OperationPlanInput {
  operation: string;
  paths: string[];
  itemCount?: number;
  requiresConfirm?: string;
  request?: Record<string, unknown>;
}

export class FileOperationLogger implements OperationLogger {
  constructor(private readonly path: string) {}

  async record(input: OperationLogRecordInput): Promise<OperationLogRecord> {
    const entry: OperationLogRecord = {
      id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      ...input
    };

    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, {
      mode: 0o600
    });
    return entry;
  }

  async recent(limit = 20): Promise<OperationLogRecord[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      const entries = raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as OperationLogRecord);
      return entries.slice(-limit).reverse();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

export function createOperationPlan(input: OperationPlanInput): Record<string, unknown> {
  return {
    dryRun: true,
    operation: input.operation,
    paths: input.paths,
    itemCount: input.itemCount ?? input.paths.length,
    requiresConfirm: input.requiresConfirm,
    request: input.request,
    nextStep:
      input.requiresConfirm === undefined
        ? "Run the same tool with dryRun=false to execute."
        : `Run the same tool with dryRun=false and confirm="${input.requiresConfirm}" to execute.`
  };
}
