import { type NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import crypto from 'node:crypto';
import { getEnv } from '@/lib/env';

const AUTH_COOKIE = 'demo-auth';
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 1 week

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<Response> {
  const env = getEnv();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return redirectToLogin(req, true);
  }

  const provided = String(formData.get('password') ?? '');
  if (!constantTimeEqual(provided, env.DEMO_PASSWORD)) {
    return redirectToLogin(req, true);
  }

  const token = await new SignJWT({ scope: 'demo' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(env.DEMO_PASSWORD_COOKIE_SECRET));

  const url = req.nextUrl.clone();
  url.pathname = '/';
  url.search = '';
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: TOKEN_TTL_SECONDS,
  });
  return res;
}

function redirectToLogin(req: NextRequest, withError: boolean): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = withError ? '?error=1' : '';
  return NextResponse.redirect(url, { status: 303 });
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Compare to itself so we still spend the same time as a real compare.
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}
