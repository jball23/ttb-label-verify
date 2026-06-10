import { type NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const AUTH_COOKIE = 'demo-auth';

const PUBLIC_PATHS = ['/login', '/api/auth'];

export const config = {
  matcher: [
    /*
     * Match every path except:
     *  - /_next/* (Next.js internals)
     *  - static files (favicon, images, etc. — extension-based)
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\..*).*)',
  ],
};

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (!token) {
    return redirectToLogin(req);
  }

  const secret = process.env.DEMO_PASSWORD_COOKIE_SECRET;
  if (!secret) {
    // Misconfiguration — fail closed.
    return redirectToLogin(req);
  }

  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return NextResponse.next();
  } catch {
    return redirectToLogin(req);
  }
}

function redirectToLogin(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}
