"use client";
// PlaceIQ placement cell: each job's applicants, their status, CVs and a CSV export.
import { Download, FileText, Mail, Phone, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STATUS_LABEL } from "@/app/jobs/jobs-view";
import { Badge, Card, Field, inputClass, Notice, Section, buttonClass } from "@/components/ui";
import { adminApi, type Applicant, type ApplicationStatus, type Job } from "@/lib/client";
import { cn } from "@/lib/cn";
import { rulesText } from "./jobs";

const STATUSES: ApplicationStatus[] = ["applied", "shortlisted", "interview", "selected", "rejected"];

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
}
const countOf = (j: Job) => Object.values(j.applicants ?? {}).reduce((a, b) => a + (b ?? 0), 0);

export function CellApplicants() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [data, setData] = useState<{ job: Job; applications: Applicant[] } | null>(null);
  const [show, setShow] = useState<ApplicationStatus[]>(STATUSES);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Load the job list; pick the job from ?job=… (link from the Jobs page) or the first with applicants.
  useEffect(() => {
    adminApi.jobs().then((list) => {
      setJobs(list);
      const wanted = Number(new URLSearchParams(window.location.search).get("job"));
      const pick = list.find((j) => j.id === wanted) ?? list.find((j) => countOf(j) > 0) ?? list[0];
      setJobId(pick ? pick.id : null);
    }).catch((e) => setError((e as Error).message));
  }, []);

  const load = useCallback(async (id: number) => {
    try { setData(await adminApi.jobApplications(id)); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    if (jobId === null) return;
    setData(null); setNote(null);
    load(jobId);
    window.history.replaceState(null, "", `/cell/applicants?job=${jobId}`);
  }, [jobId, load]);

  async function setStatus(a: Applicant, status: ApplicationStatus) {
    setError(null); setNote(null);
    setData((d) => d && { ...d, applications: d.applications.map((x) => (x.id === a.id ? { ...x, status } : x)) });
    try {
      await adminApi.setApplicationStatus(a.id, status);
      setNote(`${a.name} is now “${STATUS_LABEL[status].label}”. They'll see this on their My applications page.`);
      setJobs((list) => list && list.map((j) => {
        if (j.id !== a.job_id) return j;
        const c = { ...(j.applicants ?? {}) };
        c[a.status] = Math.max(0, (c[a.status] ?? 1) - 1);
        c[status] = (c[status] ?? 0) + 1;
        return { ...j, applicants: c };
      }));
    } catch (e) { setError((e as Error).message); if (jobId !== null) load(jobId); }
  }

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
    data?.applications.forEach((a) => { c[a.status] += 1; });
    return c;
  }, [data]);
  const visible = data?.applications.filter((a) => show.includes(a.status)) ?? [];

  if (jobs && jobs.length === 0) {
    return (
      <Card className="mt-5 text-center">
        <Users className="mx-auto size-6 text-faint" />
        <p className="mt-2 text-sm text-muted">No jobs posted yet. <Link href="/cell/jobs" className="underline">Post a job</Link> and students&apos; applications will appear here.</p>
      </Card>
    );
  }

  return (
    <>
      <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label="Job" htmlFor="ap-job">
          <select id="ap-job" className={inputClass} value={jobId ?? ""} onChange={(e) => setJobId(Number(e.target.value))} disabled={!jobs}>
            {jobs?.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} · {j.company} ({countOf(j)} applicant{countOf(j) === 1 ? "" : "s"}){j.accepting ? "" : " · closed"}
              </option>
            ))}
          </select>
        </Field>
        {data && data.applications.length > 0 && (
          <a href={adminApi.applicationsCsvUrl(data.job.id)} className={buttonClass("outline")} download>
            <Download className="size-4" />Export CSV
          </a>
        )}
      </div>

      {error && <Notice tone="error" className="mt-4">{error}</Notice>}
      {note && <Notice tone="ok" className="mt-4">{note}</Notice>}
      {jobId !== null && !data && !error && <p role="status" className="mt-5 text-sm text-faint">Loading applicants…</p>}

      {data && (
        <>
          <p className="mt-3 text-xs text-faint">
            {data.job.accepting ? "Accepting applications" : "Closed to new applications"}
            {data.job.deadline ? ` · last date ${fmtDate(data.job.deadline)}` : ""} · {rulesText(data.job)} ·{" "}
            <Link href="/cell/jobs" className="underline">Edit job</Link>
          </p>

          {data.applications.length === 0 ? (
            <Card className="mt-5 text-center">
              <Users className="mx-auto size-6 text-faint" />
              <p className="mt-2 text-sm text-muted">No one has applied to this job yet. Students see it on their Job Finder page.</p>
            </Card>
          ) : (
            <Section title={`${data.applications.length} applicant${data.applications.length === 1 ? "" : "s"}`}>
              <div role="group" aria-label="Show statuses" className="mb-4 flex flex-wrap gap-1.5">
                {STATUSES.map((s) => {
                  const on = show.includes(s);
                  return (
                    <button key={s} type="button" aria-pressed={on} onClick={() => setShow(on ? show.filter((x) => x !== s) : [...show, s])}
                      className={cn("inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium",
                        on ? "border-brand bg-brand-soft text-brand-text" : "border-border text-faint line-through hover:bg-surface-hover")}>
                      {STATUS_LABEL[s].label} ({counts[s]})
                    </button>
                  );
                })}
              </div>
              {visible.length === 0 ? <p className="text-sm text-faint">No applicants with these statuses.</p> : (
                <div className="space-y-3">{visible.map((a) => <ApplicantCard key={a.id} a={a} onStatus={(s) => setStatus(a, s)} />)}</div>
              )}
            </Section>
          )}
        </>
      )}
    </>
  );
}

function ApplicantCard({ a, onStatus }: { a: Applicant; onStatus: (s: ApplicationStatus) => void }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{a.name}</h3>
          <p className="mt-0.5 text-sm text-muted">
            Roll {a.roll_number} · {a.branch}{a.batch_year ? ` · Batch ${a.batch_year}` : ""} · Applied {fmtDate(a.applied_at)}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a href={`mailto:${a.email}`} className="inline-flex items-center gap-1 text-brand-text underline"><Mail className="size-3.5" />{a.email}</a>
            <a href={`tel:${a.phone.replace(/[\s-]/g, "")}`} className="inline-flex items-center gap-1 text-brand-text underline"><Phone className="size-3.5" />{a.phone}</a>
          </p>
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="font-display text-3xl tabular-nums text-headline">{Math.round(a.match_score * 100)}%</p>
          <p className="text-[11px] text-faint">skill match</p>
        </div>
      </div>

      <p className="mt-3 text-sm text-muted">
        CGPA <strong className="text-foreground">{a.cgpa}</strong> · {a.active_backlogs} active backlog(s) · {a.internships} internship(s) · {a.projects} project(s) · {a.certifications} certification(s)
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {a.have.map((s) => <span key={s} className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-800 dark:text-emerald-300">{s}</span>)}
        {a.missing.map((s) => <span key={s} title="Missing" className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs text-red-700 line-through decoration-1 dark:text-red-300">{s}</span>)}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor={`st-${a.id}`} className="text-xs font-semibold text-muted">Status</label>
        <select id={`st-${a.id}`} value={a.status} onChange={(e) => onStatus(e.target.value as ApplicationStatus)} className={cn(inputClass, "w-auto")}>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s].label}</option>)}
        </select>
        <Badge tone={STATUS_LABEL[a.status].tone}>{STATUS_LABEL[a.status].label}</Badge>
        {a.has_cv ? (
          <a href={adminApi.applicationCvUrl(a.id)} className={buttonClass("outline", "sm")} download>
            <FileText className="size-3.5" />Download CV
          </a>
        ) : <span className="text-xs text-faint">No CV attached</span>}
      </div>
    </div>
  );
}
