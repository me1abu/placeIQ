import { NextResponse, type NextRequest } from "next/server";
import { allowed, COOKIE, normalisePath, readSession, requiredRole } from "@/lib/auth";

// Every page and API call passes through here. Students can't open placement-cell pages and
// the placement cell uses its own pages; anyone not signed in is sent to /login.
// The engine route re-checks API access on the decoded path, so this is not the only guard.
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const need = requiredRole(pathname);
  if (need === null) return NextResponse.next();
  const session = await readSession(req.cookies.get(COOKIE)?.value);
  if (allowed(need, session)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    const msg = session ? "Your account can't use this." : "Please sign in.";
    return NextResponse.json({ detail: msg }, { status: session ? 403 : 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", normalisePath(pathname) + search);
  if (need !== "any") url.searchParams.set("need", need);
  if (session) url.searchParams.set("as", session.role);
  return NextResponse.redirect(url);
}

// Everything except Next's own static files and the favicon.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
