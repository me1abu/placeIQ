"use client";
import { Briefcase, CalendarDays, Check, IndianRupee, MapPin, Search, Star } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { rulesText } from "@/components/cell/jobs";
import { EngineStatus, Loading } from "@/components/status";
import { Badge, Button, ButtonLink, Card, Field, inputClass, Notice } from "@/components/ui";
import { useStudent } from "@/components/use-student";
import { api, contactApi, type ApplicationStatus, type FeedJob, type MatchBand, type Profile } from "@/lib/client";
import { cn } from "@/lib/cn";

const BANDS: { id: MatchBand; label: string; icon: string; tone: "good" | "warn" | "bad" | "muted" }[] = [
  { id: "eligible", label: "Eligible", icon: "✅", tone: "good" },
  { id: "almost", label: "Almost there", icon: "🟡", tone: "warn" },
  { id: "stretch", label: "Stretch", icon: "🔴", tone: "bad" },
  { id: "not_eligible", label: "Not eligible", icon: "⛔", tone: "muted" },
];
export const BAND = Object.fromEntries(BANDS.map((b) => [b.id, b])) as Record<MatchBand, (typeof BANDS)[number]>;
const RANK: Record<MatchBand, number> = { eligible: 0, almost: 1, stretch: 2, not_eligible: 3 };

export const STATUS_LABEL: Record<ApplicationStatus, { label: string; tone: "info" | "good" | "warn" | "bad" | "muted" }> = {
  applied: { label: "Applied", tone: "info" },
  shortlisted: { label: "Shortlisted", tone: "warn" },
  interview: { label: "Interview", tone: "warn" },
  selected: { label: "Selected", tone: "good" },
  rejected: { label: "Not selected", tone: "bad" },
};
const TYPE_LABEL = { full_time: "Full time", internship: "Internship" } as const;

function fmtDate(iso: string | null) {
  return iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
}

export function JobsView() {
  const st = useStudent();
  const [jobs, setJobs] = useState<FeedJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [show, setShow] = useState<MatchBand[]>(["eligible", "almost", "stretch", "not_eligible"]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [q, setQ] = useState("");
  const [applying, setApplying] = useState<number | null>(null);
  const [roll, setRoll] = useState("");

  const batch = st.stored?.batch_year ?? null;
  const load = useCallback(async () => {
    try { setJobs(await api.jobFeed(st.profile, batch)); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, [st.profile, batch]);

  useEffect(() => { if (!st.loading && st.health) load(); }, [st.loading, st.health, load]);
  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" }).then((r) => r.json()).then((s: { roll: string | null }) => setRoll(s.roll ?? "")).catch(() => {});
  }, []);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (jobs ?? [])
      .filter((j) => !savedOnly || j.saved)
      .filter((j) => !j.match || show.includes(j.match.band))
      .filter((j) => !term || `${j.title} ${j.company} ${j.location} ${j.skills.join(" ")}`.toLowerCase().includes(term))
      .sort((a, b) => (a.match && b.match ? RANK[a.match.band] - RANK[b.match.band] || b.match.score - a.match.score : 0));
  }, [jobs, show, savedOnly, q]);

  async function toggleSave(j: FeedJob) {
    setJobs((list) => list?.map((x) => (x.id === j.id ? { ...x, saved: !j.saved } : x)) ?? null);
    try { await (j.saved ? api.unsaveJob(j.id) : api.saveJob(j.id)); }
    catch (e) { setError((e as Error).message); load(); }
  }

  if (st.loading) return <Loading />;
  const counts = Object.fromEntries(BANDS.map((b) => [b.id, (jobs ?? []).filter((j) => j.match?.band === b.id).length])) as Record<MatchBand, number>;

  return (
    <>
      <EngineStatus health={st.health} loading={false} />
      {!st.profile && st.health && (
        <Notice tone="info" className="mt-5">
          Save your profile to see how well you match each job and to apply.{" "}
          <Link href="/profile" className="font-medium underline">Set up my profile</Link>
        </Notice>
      )}
      {st.profile && batch === null && <Notice className="mt-5">Set your graduating batch on your profile; some jobs are open to certain batches only.</Notice>}

      <div className="mt-5 grid gap-3 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input aria-label="Search jobs" placeholder="Search title, company, skill" className={cn(inputClass, "pl-8")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {st.profile && (
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            {BANDS.map((b) => {
              const on = show.includes(b.id);
              return (
                <button key={b.id} type="button" aria-pressed={on} onClick={() => setShow(on ? show.filter((x) => x !== b.id) : [...show, b.id])}
                  className={cn("inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors",
                    on ? "border-brand bg-brand-soft text-brand-text" : "border-border text-faint line-through hover:bg-surface-hover")}>
                  <span aria-hidden>{b.icon}</span>{b.label} ({counts[b.id]})
                </button>
              );
            })}
          </div>
        )}
        <button type="button" aria-pressed={savedOnly} onClick={() => setSavedOnly(!savedOnly)}
          className={cn("inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-medium",
            savedOnly ? "border-brand bg-brand-soft text-brand-text" : "border-border text-muted hover:bg-surface-hover")}>
          <Star className={cn("size-3.5", savedOnly && "fill-current")} />Saved only
        </button>
      </div>

      {error && <Notice tone="error" className="mt-4">{error}</Notice>}
      {note && <Notice tone="ok" className="mt-4">{note}</Notice>}
      {st.health && jobs === null && !error && <Loading label="Loading jobs…" />}

      {jobs && jobs.length === 0 && (
        <Card className="mt-5 text-center">
          <Briefcase className="mx-auto size-6 text-faint" />
          <p className="mt-2 text-sm text-muted">No jobs are open right now. Your placement cell posts new openings here; check back soon.</p>
        </Card>
      )}
      {jobs && jobs.length > 0 && visible.length === 0 && <p className="mt-6 text-sm text-faint">No jobs match these filters.</p>}

      <div className="mt-5 space-y-4">
        {visible.map((j) => (
          <JobCard key={j.id} job={j} canApply={!!st.profile} onSave={() => toggleSave(j)}
            applying={applying === j.id} onApply={() => { setApplying(j.id); setNote(null); }} onCancel={() => setApplying(null)}
            form={applying === j.id && st.profile ? (
              <ApplyForm job={j} roll={roll} profile={st.profile} batch={batch} defaultName={st.stored?.name ?? ""}
                onCancel={() => setApplying(null)}
                onDone={async () => { setApplying(null); setNote(`Application sent to ${j.company} for “${j.title}”.`); await load(); }} />
            ) : null} />
        ))}
      </div>
    </>
  );
}

function JobCard({ job: j, canApply, applying, form, onApply, onSave }: {
  job: FeedJob; canApply: boolean; applying: boolean; form: React.ReactNode; onApply: () => void; onCancel: () => void; onSave: () => void;
}) {
  const m = j.match;
  const band = m ? BAND[m.band] : null;
  const status = j.application_status ? STATUS_LABEL[j.application_status] : null;
  const blocked = m?.band === "not_eligible";
  return (
    <Card className={cn(applying && "ring-2 ring-brand/50")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-foreground">{j.title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1"><Briefcase className="size-3.5" />{j.company}</span>
            {j.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{j.location}</span>}
            <span>{TYPE_LABEL[j.job_type]}</span>
            {j.posted_at && <span>Posted {fmtDate(j.posted_at)}</span>}
          </p>
          {(j.salary || j.deadline) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {j.salary && <span className="inline-flex items-center gap-1"><IndianRupee className="size-3.5" />{j.salary.replace(/^₹\s*/, "")}</span>}
              {j.deadline && <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />Apply by {fmtDate(j.deadline)}</span>}
            </p>
          )}
        </div>
        {band && m && (
          <div className="shrink-0 sm:text-right">
            <Badge tone={band.tone}><span aria-hidden>{band.icon}</span>{band.label}</Badge>
            <p className="mt-1 font-display text-4xl tabular-nums text-headline" title="Share of the job's required skills you have">{Math.round(m.score * 100)}%</p>
            <p className="text-[11px] text-faint">skill match</p>
          </div>
        )}
      </div>

      <p className="mt-3 whitespace-pre-line text-sm leading-6 text-foreground">{j.description}</p>

      {m ? (
        <div className="mt-3 space-y-2">
          {m.have.length > 0 && <SkillRow label="You have" skills={m.have} tone="have" />}
          {m.missing.length > 0 && <SkillRow label="Missing" skills={m.missing} tone="missing" />}
          {m.reasons.length > 0 && (
            <ul className="space-y-0.5 text-sm text-red-700 dark:text-red-400">
              {m.reasons.map((r) => <li key={r}>✕ {r}</li>)}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-3"><SkillRow label="Skills" skills={j.skills} tone="plain" /></div>
      )}
      <p className="mt-2 text-xs text-faint">Eligibility: {rulesText(j)}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {status ? (
          <>
            <Badge tone={status.tone} className="min-h-10 px-3 text-sm"><Check className="size-4" />{status.label}</Badge>
            <ButtonLink href="/applications" variant="ghost" size="sm">View in My applications</ButtonLink>
          </>
        ) : !j.accepting ? (
          <Badge>Applications closed</Badge>
        ) : (
          <Button onClick={onApply} disabled={!canApply || blocked || applying}
            title={!canApply ? "Save your profile first" : blocked ? "You don't meet this job's eligibility rules" : undefined}>
            Apply
          </Button>
        )}
        <Button variant="outline" onClick={onSave} aria-pressed={j.saved}>
          <Star className={cn("size-4", j.saved && "fill-current text-brand-text")} />{j.saved ? "Saved" : "Save"}
        </Button>
      </div>
      {form}
    </Card>
  );
}

function SkillRow({ label, skills, tone }: { label: string; skills: string[]; tone: "have" | "missing" | "plain" }) {
  const cls = { have: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300", missing: "bg-red-500/15 text-red-700 dark:text-red-300", plain: "bg-surface-hover" }[tone];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm text-muted">{label}:</span>
      {skills.map((s) => <span key={s} className={cn("rounded-full px-2.5 py-0.5 text-xs", cls)}>{s}</span>)}
    </div>
  );
}

function ApplyForm({ job, roll, profile, batch, defaultName, onCancel, onDone }: {
  job: FeedJob; roll: string; profile: Profile; batch: number | null; defaultName: string; onCancel: () => void; onDone: () => void;
}) {
  const saved = contactApi.get();
  const [name, setName] = useState(saved?.name ?? defaultName);
  const [email, setEmail] = useState(saved?.email ?? "");
  const [phone, setPhone] = useState(saved?.phone ?? "");
  const [cv, setCv] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Enter your full name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (!/^\+?[0-9][0-9 -]{8,18}[0-9]$/.test(phone.trim())) return setError("Enter a valid phone number (10 digits, optionally with +91).");
    if (cv && cv.size > 5 * 1024 * 1024) return setError("The CV must be 5 MB or smaller.");
    if (!consent) return setError("Tick the consent box to send your application.");
    setBusy(true);
    try {
      await api.applyJob(job.id, { name: name.trim(), email: email.trim(), phone: phone.trim(), roll_number: roll, batch_year: batch, consent, profile }, cv);
      contactApi.save({ name: name.trim(), email: email.trim(), phone: phone.trim() });
      onDone();
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4 rounded-xl border border-border bg-background/40 p-4">
      <h4 className="text-sm font-semibold">Apply to {job.title} at {job.company}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name *" htmlFor={`ap-name-${job.id}`}><input id={`ap-name-${job.id}`} autoComplete="name" className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Roll / enrolment number" htmlFor={`ap-roll-${job.id}`}><input id={`ap-roll-${job.id}`} readOnly className={inputClass} value={roll} /></Field>
        <Field label="Email *" htmlFor={`ap-email-${job.id}`}><input id={`ap-email-${job.id}`} type="email" autoComplete="email" className={inputClass} value={email} maxLength={120} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Phone *" htmlFor={`ap-phone-${job.id}`}><input id={`ap-phone-${job.id}`} type="tel" autoComplete="tel" className={inputClass} value={phone} maxLength={20} placeholder="+91 98765 43210" onChange={(e) => setPhone(e.target.value)} /></Field>
      </div>
      <Field label="CV (PDF, optional, up to 5 MB)" htmlFor={`ap-cv-${job.id}`}>
        <input id={`ap-cv-${job.id}`} type="file" accept="application/pdf,.pdf" className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          onChange={(e) => setCv(e.target.files?.[0] ?? null)} />
      </Field>
      <div className="rounded-lg bg-surface-hover/60 p-3 text-xs leading-5 text-muted">
        <p className="font-semibold text-foreground">What the placement cell will receive</p>
        <p>Your name, email, phone, roll number{cv ? ", your CV" : ""} and your current profile: {profile.branch}, CGPA {profile.cgpa}, {profile.active_backlogs} active backlog(s), {profile.internships} internship(s), {profile.projects} project(s), {profile.certifications} certification(s), {profile.skills.length} skills{batch ? `, batch ${batch}` : ""}.</p>
        <p className="mt-1">It&apos;s stored only with this application and deleted if you withdraw it.</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 accent-[var(--color-brand)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        I agree to share these details with my institute&apos;s placement cell and {job.company} for this application.
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send application"}</Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}
