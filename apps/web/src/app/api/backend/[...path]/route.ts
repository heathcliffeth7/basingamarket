import { NextResponse } from 'next/server';

const DEFAULT_INTERNAL_API_BASE_URL = 'http://127.0.0.1:8080';
const FORWARDED_HEADERS = ['authorization', 'content-type'] as const;

type RouteContext = {
  params: Promise<{ path?: string[] }> | { path?: string[] };
};

async function readPathSegments(context: RouteContext) {
  const params = await context.params;
  return params.path ?? [];
}

export function backendTargetUrl(requestUrl: string, pathSegments: string[]) {
  const sourceUrl = new URL(requestUrl);
  const baseUrl = (process.env.API_INTERNAL_BASE_URL || DEFAULT_INTERNAL_API_BASE_URL).replace(/\/$/, '');
  const encodedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join('/');
  const targetUrl = new URL(`/${encodedPath}`, baseUrl);
  targetUrl.search = sourceUrl.search;
  return targetUrl.toString();
}

function forwardedHeaders(request: Request) {
  const headers = new Headers({ accept: 'application/json' });
  for (const header of FORWARDED_HEADERS) {
    const value = request.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  }
  return headers;
}

async function proxyBackendRequest(request: Request, context: RouteContext) {
  const method = request.method.toUpperCase();
  const pathSegments = await readPathSegments(context);
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

  try {
    const response = await fetch(backendTargetUrl(request.url, pathSegments), {
      method,
      headers: forwardedHeaders(request),
      body,
      cache: 'no-store'
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch {
    return NextResponse.json(
      { error: 'backend_unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export function GET(request: Request, context: RouteContext) {
  return proxyBackendRequest(request, context);
}

export function POST(request: Request, context: RouteContext) {
  return proxyBackendRequest(request, context);
}

export function DELETE(request: Request, context: RouteContext) {
  return proxyBackendRequest(request, context);
}
