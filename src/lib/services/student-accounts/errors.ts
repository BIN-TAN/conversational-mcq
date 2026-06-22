export class StudentAccountServiceError extends Error {
  code: string;
  details: Record<string, unknown>;
  status: number;

  constructor(
    code: string,
    message: string,
    status = 400,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "StudentAccountServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
