// Guards every write to this app's API. A browser sends another site's POST without
// asking first only when the body is form data or text/plain. Requiring JSON on every
// write forces a CORS preflight, which this app never answers, so another site cannot
// drive these routes from a visitor's browser. A browser request from a different host
// is refused outright.
//
// This is not authentication: the app has no login of its own, so `npm run dev` and
// `npm start` listen on 127.0.0.1 only. Put your own auth in front before you deploy it.
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  if (request.method === 'GET' || request.method === 'HEAD') return NextResponse.next();
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: { code: 'unsupported_media_type', message: 'Send the request with Content-Type: application/json.' } }, { status: 415 });
  }
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) {
    return NextResponse.json({ error: { code: 'forbidden', message: 'Cross-origin requests are not allowed.' } }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
