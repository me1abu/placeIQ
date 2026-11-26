"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { isActive, navFor, type NavRole } from "@/lib/nav";
import { Wordmark } from "./logo";
import { ThemeToggle } from "./theme-toggle";

function NavLinks({ pathname, role, onNavigate }: { pathname: string; role: NavRole; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {navFor(role).map((group, gi) => (
        <div key={gi} className={cn(gi > 0 && "mt-4")}>
          {group.title && <p className="px-3 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">{group.title}</p>}
          {group.items.map(({ href, label, icon: Icon }) => {
            const active = isActive(href, pathname);
            return (
              <Link key={href} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors",
                  active ? "bg-brand-soft font-medium text-brand-text" : "text-muted hover:bg-surface-hover hover:text-foreground",
                )}>
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<{ role: NavRole; roll: string | null }>({ role: "guest", roll: null });
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" }).then((r) => r.json())
      .then((s: { role: "student" | "cell" | null; roll: string | null }) => setWho({ role: s.role ?? "guest", roll: s.roll }))
      .catch(() => {});
  }, [pathname]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setWho({ role: "guest", roll: null });
    window.location.assign("/login");
  }

  const account = who.role !== "guest" && (
    <div className="flex flex-col gap-1">
      <p className="px-2 text-xs text-muted">
        Signed in as <span className="font-medium text-foreground">{who.role === "cell" ? "Placement cell" : who.roll ?? "student"}</span>
      </p>
      <button type="button" onClick={signOut} className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-xs text-muted hover:bg-surface-hover hover:text-foreground">
        <LogOut className="size-4" />Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-background px-3 py-5 md:flex">
        <Link href="/" className="mb-6 px-2" aria-label="PlaceIQ home"><Wordmark /></Link>
        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar"><NavLinks pathname={pathname} role={who.role} /></div>
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
          <ThemeToggle />
          {account}
          <p className="px-2 text-[11px] leading-4 text-faint">Your profile stays in this browser. Nothing is shared unless you choose to.</p>
        </div>
      </aside>

      {/* Mobile header + drawer */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
        <Link href="/" aria-label="PlaceIQ home"><Wordmark /></Link>
        <div className="flex items-center gap-1">
          <ThemeToggle compact />
          <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="inline-flex size-11 items-center justify-center rounded-md hover:bg-surface-hover">
            <Menu className="size-5" />
          </button>
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-background px-3 py-5 shadow-xl">
            <div className="mb-6 flex items-center justify-between px-2">
              <Wordmark />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="inline-flex size-11 items-center justify-center rounded-md hover:bg-surface-hover"><X className="size-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto"><NavLinks pathname={pathname} role={who.role} onNavigate={() => setOpen(false)} /></div>
            {account && <div className="mt-4 border-t border-border pt-3">{account}</div>}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
