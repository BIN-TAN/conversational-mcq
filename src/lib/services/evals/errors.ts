export class EvalServiceError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "EvalServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
