import { NextResponse } from 'next/server';
import { type ZodType } from 'zod';
import { describeError, InvalidRequestError } from '@/lib/labels/errors';

type RouteContext = { params: Promise<{ id: string }> };

/** Runs a handler and turns any thrown error into a plain-language JSON error. */
export function handle<C = RouteContext>(
  handler: (request: Request, context: C) => Promise<unknown>,
): (request: Request, context: C) => Promise<Response> {
  return async (request, context) => {
    try {
      const result = await handler(request, context);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (error) {
      const { message, status } = describeError(error);
      if (status >= 500) console.error('[labels]', error);
      return NextResponse.json({ error: message }, { status });
    }
  };
}

export function parseWith<T>(schema: ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidRequestError(message);
  return result.data;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new InvalidRequestError('The request body must be JSON.');
  }
}
