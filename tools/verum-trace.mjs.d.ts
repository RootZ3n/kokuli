export type TraceRunOptions = {
  runId: string;
  kokuliRoot?: string;
  squidleyRoot?: string;
  ptahRoot?: string;
  since?: string;
  limit?: number;
};

export type TraceRunResult = {
  ok: boolean;
  [key: string]: unknown;
};

export function traceRun(options: TraceRunOptions): Promise<TraceRunResult>;
export function formatHuman(result: TraceRunResult): string;
