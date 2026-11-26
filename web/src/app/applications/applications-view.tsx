"use client";
import { Briefcase, CalendarDays, FileText, MapPin, Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BAND, STATUS_LABEL } from "@/app/jobs/jobs-view";
import { EngineStatus, Loading } from "@/components/status";
import { Badge, Button, ButtonLink, Notice, Section, Tile } from "@/components/ui";
import { useStudent } from "@/components/use-student";
import { api, type ApplicationStatus, type MyApplication, type SavedJobEntry } from "@/lib/client";
import { cn } from "@/lib/cn";

const TYPE_LABEL = { full_time: "Full time", internship: "Internship" } as const;
const STEPS = ["Applied", "Shortlisted", "Interview", "Result"] as const;
const STEP_OF: Record<ApplicationStatus, number> = { applied: 0, shortlisted: 1, interview: 2, selected: 3, rejected: 3 };
const STATUS_HELP: Record<ApplicationStatus, string> = {
  applied: "Sent to the placement cell. You can still withdraw it.",
  shortlisted: "You've been shortlisted. The placement cell will contact you about next steps.",
  interview: "You're at the interview stage. Watch your email and phone.",
  selected: "Congratulations, you've been selected! The placement cell will share the offer details.",
  rejected: "Not selected this time. Keep applying; check your Roadmap for skills to build.",
};

function fmtDate(iso: string | null) {
  return iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
}

export function ApplicationsView() {
  const st = useStudent();
  const [data, setData] = useState<{ applications: MyApplication[]; saved: SavedJobEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const batch = st.stored?.batch_year ?? null;

  const load = useCallback(async () => {
    try { setData(await api.myJobs(st.profile, batch)); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, [st.profile, batch]);
  useEffect(() => { if (!st.loading && st.health) load(); }, [st.loading, st.health, load]);

  async function withdraw(a: MyApplication) {
    const what = a.job ? `“${a.job.title}” at ${a.job.company}` : "this job";
    if (!confirm(`Withdraw your application to ${what}? Everything you shared with it (contact details${a.cv_filename ? ", CV" : ""} and profile) will be deleted.`)) return;
    setError(null); setNote(null);
    try { await api.withdrawApplication(a.job_id); setNote(`Withdrawn your application to ${what}.`); await load(); }
    catch (e) { setError((e as Error).message); }
  }

  async function unsave(j: SavedJobEntry) {
    setError(null); setNote(null);
    try { await api.unsaveJob(j.id); await load(); }
    catch (e) { setError((e as Error).message); }
  }

  if (st.loading) return <Loading />;
  const apps = data?.applications ?? [];
  const active = apps.filter((a) => ["applied", "shortlisted", "interview"].includes(a.status)).length;

  return (
    <>
      <EngineStatus health={st.health} loading={false} />
      {error && <Notice tone="error" className="mt-4">{error}</Notice>}
      {note && <Notice tone="ok" className="mt-4">{note}</Notice>}
      {st.health && !data && !error && <Loading label="Loading your applications…" />}

      {data && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Applications" value={apps.length} />
            <Tile label="In progress" value={active} />
            <Tile label="Selected" value={apps.filter((a) => a.status === "selected").length} />
            <Tile label="Saved jobs" value={data.saved.length} />
          </div>

          <Section title={`Applications (${apps.length})`}>
            {apps.length === 0 ? (
              <EmptyState text="You haven't applied to any jobs yet." />
            ) : (
              <div className="space-y-4">{apps.map((a) => <ApplicationCard key={a.job_id} app={a} onWithdraw={() => withdraw(a)} />)}</div>
            )}
          </Section>

          <Section title={`Saved jobs (${data.saved.length})`}>
            {data.saved.length === 0 ? (
              <EmptyState text="No saved jobs. Tap Save on a job in the Job Finder to keep it here." />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">{data.saved.map((j) => <SavedCard key={j.id} job={j} onRemove={() => unsave(j)} />)}</div>
            )}
          </Section>
        </>
      )}
    </>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">{text}</p>
      <ButtonLink href="/jobs" variant="outline" size="sm"><Briefcase className="size-3.5" />Browse jobs</ButtonLink>
    </div>
  );
}

function ApplicationCard({ app: a, onWithdraw }: { app: MyApplication; onWithdraw: () => void }) {
  const status = STATUS_LABEL[a.status];
  const step = STEP_OF[a.status];
  const j = a.job;
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{j?.title ?? "Job removed"}</h3>
          {j && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1"><Briefcase className="size-3.5" />{j.company}</span>
              {j.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{j.location}</span>}
              <span>{TYPE_LABEL[j.job_type]}</span>
              <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />Applied {fmtDate(a.applied_at)}</span>
            </p>
          )}
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {/* Progress: Applied → Shortlisted → Interview → Result */}
      <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Application progress">
        {STEPS.map((label, i) => {
          const done = i <= step;
          const result = i === 3 && step === 3;
          const bar = !done ? "bg-surface-hover" : result ? (a.status === "selected" ? "bg-emerald-500" : "bg-red-500") : "bg-brand";
          return (
            <li key={label} aria-current={i === step ? "step" : undefined}>
              <div className={cn("h-1.5 rounded-full", bar)} />
              <p className={cn("mt-1 text-[11px]", done ? "font-medium text-foreground" : "text-faint")}>
                {result ? (a.status === "selected" ? "Selected" : "Not selected") : label}
              </p>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm text-muted">{STATUS_HELP[a.status]}</p>

      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer select-none">What you shared · skill match at apply time {Math.round(a.match_score * 100)}%</summary>
        <div className="mt-2 space-y-1 rounded-lg bg-surface-hover/60 p-3 leading-5">
          <p>{a.shared.name} · {a.shared.email} · {a.shared.phone} · Roll {a.shared.roll_number}</p>
          <p>{a.shared.branch} · CGPA {a.shared.cgpa} · {a.shared.active_backlogs} active backlog(s){a.shared.batch_year ? ` · Batch ${a.shared.batch_year}` : ""}</p>
          <p>Skills: {a.shared.skills.join(", ") || "none"}</p>
          <p className="inline-flex items-center gap-1"><FileText className="size-3.5" />{a.cv_filename ? `CV: ${a.cv_filename}` : "No CV attached"}</p>
        </div>
      </details>

      {a.status === "applied" && (
        <div className="mt-3">
          <Button variant="outline" size="sm" className="text-red-700 dark:text-red-400" onClick={onWithdraw}>Withdraw application</Button>
        </div>
      )}
    </div>
  );
}

function SavedCard({ job: j, onRemove }: { job: SavedJobEntry; onRemove: () => void }) {
  const band = j.match ? BAND[j.match.band] : null;
  return (
    <div className="flex flex-col rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{j.title}</h3>
          <p className="mt-0.5 text-sm text-muted">{j.company}{j.location ? ` · ${j.location}` : ""}</p>
          {j.deadline && <p className="mt-0.5 text-xs text-faint">Apply by {fmtDate(j.deadline)}</p>}
        </div>
        {band && j.match && (
          <div className="shrink-0 text-right">
            <Badge tone={band.tone}><span aria-hidden>{band.icon}</span>{band.label}</Badge>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{Math.round(j.match.score * 100)}%</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {j.applied ? <Badge tone="info">Applied</Badge>
          : j.accepting ? <ButtonLink href="/jobs" size="sm">Apply on Job Finder</ButtonLink>
          : <Badge>Applications closed</Badge>}
        <Button variant="ghost" size="sm" onClick={onRemove}><Star className="size-3.5 fill-current" />Remove</Button>
      </div>
    </div>
  );
}
