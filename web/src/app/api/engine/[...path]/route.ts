// Server-side proxy from the web app to the local PlaceIQ engine
// (python -m placeiq serve, 127.0.0.1:8765 by default). The browser only talks to this
// Next app; the engine never needs to be reachable from anything but this machine.
// Only the engine's own route families are forwarded.

import { cookies } from "next/headers";
import { allowed, COOKIE, ENGINE, readSession, requiredRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["health", "taxonomy", "parse", "parse-text", "predict", "score", "whatif", "roadmap", "students", "admin"]);
const PASS_HEADERS = ["content-type", "content-disposition", "cache-control"];

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  if (!path?.length || !ALLOWED.has(path[0]) || path.some((p) => p === ".." || p === "." || p.includes("\\"))) {
    return Response.json({ detail: "Unknown engine route" }, { status: 404 });
  }
  // Authoritative role check, on the decoded path (the page proxy sees the raw URL, so an
  // encoded segment such as /api/engine/%61dmin/... must not get past this one).
  const session = await readSession((await cookies()).get(COOKIE)?.value);
  const need = requiredRole(`/api/engine/${path.join("/")}`);
  if (!allowed(need, session)) {
    return Response.json({ detail: session ? "Your account can't use this." : "Please sign in." }, { status: session ? 403 : 401 });
  }
  const target = `${ENGINE}/api/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}`;
  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  // Tells the engine which student is signed in, so they can only share/withdraw their own profile.
  if (path[0] === "students" && session?.role === "student") headers.set("x-placeiq-student", session.sub);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let res: Response;
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(180_000), // training can take about a minute
    });
  } catch {
    return Response.json({ detail: "The PlaceIQ engine isn't running. Start everything with start.bat." }, { status: 503 });
  }
  const out = new Headers();
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
