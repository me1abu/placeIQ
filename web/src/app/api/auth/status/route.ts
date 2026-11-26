import { cookies } from "next/headers";
import { adminPassword, COOKIE, readSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await readSession((await cookies()).get(COOKIE)?.value);
  return Response.json({
    signedIn: !!s,
    role: s?.role ?? null,
    roll: s?.role === "student" ? s.roll ?? null : null,
    cellLoginEnabled: !!adminPassword(),
  });
}
