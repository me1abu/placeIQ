import { sessionCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of sessionCookies(null, "", false)) headers.append("set-cookie", c);
  return new Response(JSON.stringify({ ok: true }), { headers });
}
