export declare function verifyPublisherDependency(manifest: unknown, lock: unknown): void;
export declare function safeDependencyFailure(error: unknown): string;
export declare function validateAuditResult(result: {
  error?: unknown;
  status: number | null;
  stdout: string;
}): {
  info: number;
  low: number;
  moderate: number;
  high: number;
  critical: number;
  total: number;
};
