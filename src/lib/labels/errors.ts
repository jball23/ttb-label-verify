/**
 * Typed failures for the label pipeline. Each carries the plain-language
 * message a reviewer sees, so callers never pattern-match error strings to
 * decide what to say.
 */
export class LabelPipelineError extends Error {
  constructor(
    readonly userMessage: string,
    readonly httpStatus: number,
    options?: { cause?: unknown },
  ) {
    super(userMessage, options);
    this.name = new.target.name;
  }
}

export class ReaderAuthError extends LabelPipelineError {
  constructor(cause?: unknown) {
    super('The label reader is not set up correctly. Ask an administrator to check the AI service key.', 502, { cause });
  }
}

export class ReaderRateLimitError extends LabelPipelineError {
  constructor(cause?: unknown) {
    super('Too many labels are being checked at once. Try this label again in a moment.', 503, { cause });
  }
}

export class ReaderTimeoutError extends LabelPipelineError {
  constructor(cause?: unknown) {
    super('Reading this label took too long. Try it again.', 504, { cause });
  }
}

export class ReaderResponseError extends LabelPipelineError {
  constructor(cause?: unknown) {
    super('The label reader returned something unexpected. Try this label again.', 502, { cause });
  }
}

export class DatabaseError extends LabelPipelineError {
  constructor(cause?: unknown) {
    super('The result could not be saved. Try again, or contact an administrator if it keeps happening.', 503, { cause });
  }
}

export class InvalidRequestError extends LabelPipelineError {
  constructor(userMessage: string) {
    super(userMessage, 400);
  }
}

export class LabelNotFoundError extends LabelPipelineError {
  constructor() {
    super('This label could not be found. It may have been checked on another server without a database.', 404);
  }
}

/** Message and status for any error, without leaking internals. */
export function describeError(error: unknown): { message: string; status: number } {
  if (error instanceof LabelPipelineError) {
    return { message: error.userMessage, status: error.httpStatus };
  }
  return { message: 'Something went wrong checking this label. Try it again.', status: 500 };
}
