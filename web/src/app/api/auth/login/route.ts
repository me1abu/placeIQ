import { adminPassword, checkPassword, ENGINE, makeSession, safeNext, sessionCookies, type Role } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { role?: unknown; mode?: unknown; roll_number?: unknown; password?: unknown; next?: unknown };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const fail = (detail: string, status: number) => Response.json({ detail }, { status });
const slow = () => new Promise((r) => setTimeout(r, 400)); // slow down guessing

// POST { role: "student", mode: "login" | "register", roll_number, password }
//   or { role: "cell", password }
export async function POST(req: Request) {
  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { /* empty body */ }
  const role = str(body.role) as Role;
  const password = str(body.password);
  let sub: string;
  let roll: string | undefined;

  if (role === "cell") {
    const expected = adminPassword();
    if (!expected) return fail("Placement-cell sign-in isn't set up: add PLACEIQ_ADMIN_PASSWORD to .env and restart.", 503);
    if (!(await checkPassword(password, expected))) { await slow(); return fail("Incorrect placement-cell password.", 401); }
    sub = "cell";
  } else if (role === "student") {
    const mode = str(body.mode) === "register" ? "register" : "login";
    roll = str(body.roll_number).trim().toUpperCase();
    if (roll.length < 3) return fail("Enter your roll / enrolment number.", 422);
    let res: Response;
    try {
      res = await fetch(`${ENGINE}/api/auth/${mode}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ roll_number: roll, password }), cache: "no-store",
      });
    } catch {
      return fail("The PlaceIQ engine isn't running. Start everything with start.bat.", 503);
    }
    const out = (await res.json().catch(() => ({}))) as { student_hash?: string; detail?: unknown };
    if (!res.ok || !out.student_hash) {
      if (res.status === 401) await slow();
      const d = out.detail;
      const msg = typeof d === "string" ? d : Array.isArray(d) ? "Use letters, digits and - / _ . in the roll number." : "Sign-in failed.";
      return fail(msg, res.status === 200 ? 500 : res.status);
    }
    sub = out.student_hash;
  } else {
    return fail("Choose Student or Placement cell.", 400);
  }

  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of sessionCookies(await makeSession({ role, sub, roll }), sub, secure)) headers.append("set-cookie", c);
  return new Response(JSON.stringify({ ok: true, role, redirect: safeNext(str(body.next), role) }), { headers });
}
