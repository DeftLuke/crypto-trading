import { NextRequest, NextResponse } from "next/server";

const RESEARCH_API = (process.env.RESEARCH_API_URL || "http://research-api:8100").replace(/\/$/, "");
const TRADING_API = (process.env.TRADING_API_URL || "http://127.0.0.1:3002").replace(/\/$/, "");

async function proxyTo(url: string, req: NextRequest, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  });
}

async function proxy(req: NextRequest, pathSegments: string[]) {
  const path = pathSegments.join("/");
  const search = req.nextUrl.search;
  const target = `${RESEARCH_API}/${path}${search}`;
  const fallback = `${TRADING_API}/api/research/${path}${search}`;

  const headers: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") || "application/json",
  };
  const auth = req.headers.get("authorization");
  if (auth) headers.Authorization = auth;

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const res = await fetch(target, init);
    if (res.ok || res.status === 409) {
      const body = await res.text();
      return new NextResponse(body, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
      });
    }
    console.warn(`[research proxy] ${target} → ${res.status}, trying trading API fallback`);
  } catch (err) {
    console.warn(`[research proxy] ${target} failed:`, err instanceof Error ? err.message : err);
  }

  try {
    return await proxyTo(fallback, req, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy request failed";
    return NextResponse.json({ error: message, target, fallback }, { status: 502 });
  }
}

type RouteCtx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
