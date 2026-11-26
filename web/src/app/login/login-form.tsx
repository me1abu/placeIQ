"use client";
import { Building2, GraduationCap, Lock } from "lucide-react";
import { useState } from "react";
import { Button, Card, Field, inputClass, Notice } from "@/components/ui";
import { cn } from "@/lib/cn";

type Role = "student" | "cell";
type Mode = "login" | "register";

const ROLES: { id: Role; label: string; icon: typeof GraduationCap }[] = [
  { id: "student", label: "Student", icon: GraduationCap },
  { id: "cell", label: "Placement cell", icon: Building2 },
];

export function LoginForm({ next, initialRole, wrongRole }: { next: string; initialRole: Role; wrongRole: Role | null }) {
  const [role, setRole] = useState<Role>(initialRole);
  const [mode, setMode] = useState<Mode>("login");
  const [roll, setRoll] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const registering = role === "student" && mode === "register";

  function pick(r: Role) { setRole(r); setError(null); setPassword(""); setConfirm(""); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (registering) {
      if (password.length < 8) { setError("Choose a password of at least 8 characters."); return; }
      if (password !== confirm) { setError("The two passwords don't match."); return; }
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, mode, roll_number: roll, password, next }),
      });
      const out = (await r.json().catch(() => ({}))) as { detail?: string; redirect?: string };
      if (!r.ok) throw new Error(out.detail ?? "Sign-in failed.");
      window.location.assign(out.redirect ?? "/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card accent className="mx-auto mt-8 max-w-md">
      {wrongRole && wrongRole !== role && (
        <Notice tone="warn" className="mb-4">
          {wrongRole === "student"
            ? "That page is for the placement cell only. You're signed in as a student; sign in with the placement-cell password to continue."
            : "That page is for students. You're signed in as the placement cell; sign in with a student account to continue."}
        </Notice>
      )}

      <div role="tablist" aria-label="I am a" className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
        {ROLES.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={role === id} onClick={() => pick(id)}
            className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-md text-sm transition-colors",
              role === id ? "bg-brand-soft font-medium text-brand-text" : "text-muted hover:bg-surface-hover hover:text-foreground")}>
            <Icon className="size-4" />{label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Lock className="size-4 text-brand-text" />
        <h2 className="text-base font-semibold">
          {role === "cell" ? "Placement cell sign-in" : registering ? "Create your student account" : "Student sign-in"}
        </h2>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {role === "student" && (
          <Field label="Roll / enrolment number" htmlFor="roll">
            <input id="roll" autoComplete="username" autoFocus className={inputClass} value={roll}
              onChange={(e) => setRoll(e.target.value)} />
          </Field>
        )}
        <Field label={role === "cell" ? "Placement-cell password" : "Password"} htmlFor="pw"
          hint={registering ? "At least 8 characters." : undefined}>
          <input id="pw" type="password" autoComplete={registering ? "new-password" : "current-password"}
            autoFocus={role === "cell"} className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {registering && (
          <Field label="Confirm password" htmlFor="pw2">
            <input id="pw2" type="password" autoComplete="new-password" className={inputClass} value={confirm}
              onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        )}
        <Button type="submit" disabled={busy || !password || (role === "student" && !roll.trim())}>
          {busy ? "Please wait…" : registering ? "Create account" : "Sign in"}
        </Button>
      </form>

      {error && <Notice tone="error" className="mt-4">{error}</Notice>}

      {role === "student" ? (
        <p className="mt-4 text-sm text-muted">
          {mode === "login" ? "First time here? " : "Already have an account? "}
          <button type="button" className="text-brand-text underline" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
            {mode === "login" ? "Create a student account" : "Sign in instead"}
          </button>
          <span className="mt-2 block text-xs text-faint">Forgot your password? Ask the placement cell to reset your account. Your roll number is stored only as an irreversible code.</span>
        </p>
      ) : (
        <p className="mt-4 text-xs text-faint">For placement-cell staff only. This area holds batch data and model controls. The password is set as PLACEIQ_ADMIN_PASSWORD in the app&apos;s .env file.</p>
      )}
    </Card>
  );
}
