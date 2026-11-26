"use client";
// PlaceIQ placement cell: post, edit, close and delete the jobs students apply to.
import { Briefcase, CalendarDays, IndianRupee, MapPin, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SkillPicker } from "@/components/skill-picker";
import { Badge, Button, ButtonLink, Card, Field, inputClass, Notice, Section } from "@/components/ui";
import { adminApi, BRANCHES, type Job, type JobInput } from "@/lib/client";
import { cn } from "@/lib/cn";

const YEAR = new Date().getFullYear();
const BATCHES = [0, 1, 2, 3, 4].map((d) => YEAR + d);
const TYPE_LABEL = { full_time: "Full time", internship: "Internship" } as const;

const EMPTY: JobInput = {
  company: "", title: "", location: "", job_type: "full_time", salary: "", description: "", skills: [],
  min_cgpa: 0, max_backlogs: 0, branches: [], batch_years: [], deadline: null, status: "open",
};

// The form keeps numbers as text so fields can be cleared while typing.
type Form = Omit<JobInput, "min_cgpa" | "max_backlogs"> & { min_cgpa: string; max_backlogs: string };
const toForm = (j: JobInput): Form => ({ ...j, min_cgpa: j.min_cgpa ? String(j.min_cgpa) : "", max_backlogs: j.max_backlogs === null ? "" : String(j.max_backlogs) });

function fromForm(f: Form): JobInput | string {
  const cgpa = f.min_cgpa.trim() === "" ? 0 : Number(f.min_cgpa);
  if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10) return "Minimum CGPA must be between 0 and 10.";
  const back = f.max_backlogs.trim() === "" ? null : Number(f.max_backlogs);
  if (back !== null && (!Number.isInteger(back) || back < 0)) return "Max active backlogs must be a whole number (or blank for no limit).";
  if (f.company.trim().length < 2) return "Enter the company name.";
  if (f.title.trim().length < 2) return "Enter the job title.";
  if (f.description.trim().length < 10) return "Add a short job description (at least 10 characters).";
  if (f.skills.length === 0) return "Add at least one required skill.";
  return { ...f, min_cgpa: cgpa, max_backlogs: back, deadline: f.deadline || null };
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** One line with the eligibility rules, e.g. "CGPA ≥ 6.5 · 0 backlogs · CSE, IT · Batch 2027". */
export function rulesText(j: Pick<JobInput, "min_cgpa" | "max_backlogs" | "branches" | "batch_years">): string {
  return [
    j.min_cgpa > 0 ? `CGPA ≥ ${j.min_cgpa}` : "Any CGPA",
    j.max_backlogs === null ? "Backlogs allowed" : j.max_backlogs === 0 ? "No active backlogs" : `≤ ${j.max_backlogs} active backlogs`,
    j.branches.length ? j.branches.join(", ") : "All branches",
    j.batch_years.length ? `Batch ${j.batch_years.join(", ")}` : "All batches",
  ].join(" · ");
}

export function CellJobs({ taxonomy }: { taxonomy: Record<string, string> }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; form: Form } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => adminApi.jobs().then(setJobs).catch((e) => setError((e as Error).message)), []);
  useEffect(() => { load(); }, [load]);

  function startNew() { setEditing({ id: null, form: toForm(EMPTY) }); setError(null); setNote(null); }
  function startEdit(j: Job) { setEditing({ id: j.id, form: toForm(j) }); setError(null); setNote(null); window.scrollTo({ top: 0, behavior: "smooth" }); }
  const set = (patch: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const input = fromForm(editing.form);
    if (typeof input === "string") { setError(input); return; }
    setBusy(true); setError(null);
    try {
      const saved = editing.id === null ? await adminApi.createJob(input) : await adminApi.updateJob(editing.id, input);
      setNote(editing.id === null ? `Posted “${saved.title}” at ${saved.company}.` : `Saved changes to “${saved.title}”.`);
      setEditing(null);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function setStatus(j: Job, status: "open" | "closed") {
    setError(null); setNote(null);
    try { await adminApi.updateJob(j.id, { ...j, status }); setNote(`${status === "closed" ? "Closed" : "Reopened"} “${j.title}”.`); await load(); }
    catch (err) { setError((err as Error).message); }
  }

  async function remove(j: Job) {
    if (!confirm(`Delete “${j.title}” at ${j.company}? This cannot be undone. To stop applications but keep the job, use Close instead.`)) return;
    setError(null); setNote(null);
    try { await adminApi.deleteJob(j.id); setNote(`Deleted “${j.title}”.`); await load(); }
    catch (err) { setError((err as Error).message); }
  }

  const open = jobs?.filter((j) => j.accepting).length ?? 0;

  return (
    <>
      {editing ? (
        <Section title={editing.id === null ? "Post a job" : "Edit job"}>
          <JobForm form={editing.form} set={set} taxonomy={taxonomy} busy={busy} isNew={editing.id === null}
            onSubmit={save} onCancel={() => { setEditing(null); setError(null); }} />
          {error && <Notice tone="error" className="mt-4">{error}</Notice>}
        </Section>
      ) : (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {jobs === null ? "Loading…" : `${jobs.length} job${jobs.length === 1 ? "" : "s"} posted · ${open} accepting applications`}
          </p>
          <Button onClick={startNew}><Plus className="size-4" />Post a job</Button>
        </div>
      )}

      {!editing && error && <Notice tone="error" className="mt-4">{error}</Notice>}
      {note && <Notice tone="ok" className="mt-4">{note}</Notice>}

      {jobs && jobs.length === 0 && !editing && (
        <Card className="mt-5 text-center">
          <Briefcase className="mx-auto size-6 text-faint" />
          <p className="mt-2 text-sm text-muted">No jobs yet. Post the first one; students will see it on their Job Finder page.</p>
        </Card>
      )}

      <div className="mt-5 space-y-4">
        {jobs?.map((j) => (
          <JobCard key={j.id} job={j} highlight={editing?.id === j.id}
            onEdit={() => startEdit(j)} onToggle={() => setStatus(j, j.status === "open" ? "closed" : "open")} onDelete={() => remove(j)} />
        ))}
      </div>
    </>
  );
}

function JobCard({ job: j, highlight, onEdit, onToggle, onDelete }: { job: Job; highlight: boolean; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  const passed = j.status === "open" && !j.accepting;
  const total = Object.values(j.applicants ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <Card className={cn(highlight && "ring-2 ring-brand/50", j.status === "closed" && "opacity-75")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground">{j.title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1"><Briefcase className="size-3.5" />{j.company}</span>
            {j.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{j.location}</span>}
            <span>{TYPE_LABEL[j.job_type]}</span>
            {j.salary && <span className="inline-flex items-center gap-1"><IndianRupee className="size-3.5" />{j.salary.replace(/^₹\s*/, "")}</span>}
            {j.deadline && <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />Apply by {fmtDate(j.deadline)}</span>}
          </p>
        </div>
        {j.accepting ? <Badge tone="good">● Open</Badge> : passed ? <Badge tone="warn">Deadline passed</Badge> : <Badge>Closed</Badge>}
      </div>
      <p className="mt-3 whitespace-pre-line text-sm leading-6 text-foreground">{j.description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-muted">Skills:</span>
        {j.skills.map((s) => <span key={s} className="rounded-full bg-surface-hover px-2.5 py-0.5 text-xs">{s}</span>)}
      </div>
      <p className="mt-2 text-xs text-faint">Eligibility: {rulesText(j)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <ButtonLink href={`/cell/applicants?job=${j.id}`} size="sm"><Users className="size-3.5" />Applicants ({total})</ButtonLink>
        <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="size-3.5" />Edit</Button>
        <Button variant="outline" size="sm" onClick={onToggle}>{j.status === "open" ? "Close applications" : "Reopen"}</Button>
        <Button variant="outline" size="sm" className="text-red-700 dark:text-red-400" onClick={onDelete}><Trash2 className="size-3.5" />Delete</Button>
      </div>
    </Card>
  );
}

function JobForm({ form: f, set, taxonomy, busy, isNew, onSubmit, onCancel }: {
  form: Form; set: (p: Partial<Form>) => void; taxonomy: Record<string, string>; busy: boolean; isNew: boolean;
  onSubmit: (e: React.FormEvent) => void; onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company *" htmlFor="job-company"><input id="job-company" className={inputClass} value={f.company} maxLength={80} onChange={(e) => set({ company: e.target.value })} /></Field>
        <Field label="Job title *" htmlFor="job-title"><input id="job-title" className={inputClass} value={f.title} maxLength={100} placeholder="e.g. Junior Python Developer" onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Location" htmlFor="job-location"><input id="job-location" className={inputClass} value={f.location} maxLength={80} placeholder="e.g. Bengaluru, or Remote" onChange={(e) => set({ location: e.target.value })} /></Field>
        <Field label="Type" htmlFor="job-type">
          <select id="job-type" className={inputClass} value={f.job_type} onChange={(e) => set({ job_type: e.target.value as Form["job_type"] })}>
            <option value="full_time">Full time</option><option value="internship">Internship</option>
          </select>
        </Field>
        <Field label="Salary / stipend" htmlFor="job-salary" hint="Free text, e.g. ₹4–6 LPA or ₹20,000/month. Optional.">
          <input id="job-salary" className={inputClass} value={f.salary} maxLength={60} onChange={(e) => set({ salary: e.target.value })} />
        </Field>
        <Field label="Last date to apply" htmlFor="job-deadline" hint="Blank = no deadline. Applications stop after this day.">
          <input id="job-deadline" type="date" className={inputClass} value={f.deadline ?? ""} onChange={(e) => set({ deadline: e.target.value || null })} />
        </Field>
      </div>

      <Field label="Job description *" htmlFor="job-desc">
        <textarea id="job-desc" rows={5} className={inputClass} value={f.description} maxLength={5000}
          placeholder="What the role involves and what the recruiter is looking for." onChange={(e) => set({ description: e.target.value })} />
      </Field>

      <SkillPicker taxonomy={taxonomy} value={f.skills} onChange={(skills) => set({ skills })} idPrefix="job-skill" label="Required skills * (students' match % is based on these)" />

      <fieldset className="rounded-xl border border-border p-4">
        <legend className="px-1 text-xs font-semibold text-muted">Eligibility rules (students who don&apos;t meet them can&apos;t apply)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Minimum CGPA" htmlFor="job-cgpa" hint="Blank or 0 = no minimum.">
            <input id="job-cgpa" type="number" step="0.1" min={0} max={10} className={inputClass} value={f.min_cgpa} onChange={(e) => set({ min_cgpa: e.target.value })} />
          </Field>
          <Field label="Max active backlogs" htmlFor="job-backlogs" hint="0 = none allowed. Blank = no limit.">
            <input id="job-backlogs" type="number" step="1" min={0} className={inputClass} value={f.max_backlogs} onChange={(e) => set({ max_backlogs: e.target.value })} />
          </Field>
        </div>
        <CheckGroup label="Branches (none ticked = all branches)" options={[...BRANCHES]} value={f.branches} onToggle={(b) => set({ branches: toggle(f.branches, b) })} />
        <CheckGroup label="Graduating batch (none ticked = all batches)" options={BATCHES} value={f.batch_years} onToggle={(y) => set({ batch_years: toggle(f.batch_years, y).sort() })} />
      </fieldset>

      {!isNew && (
        <Field label="Status" htmlFor="job-status">
          <select id="job-status" className={cn(inputClass, "max-w-xs")} value={f.status} onChange={(e) => set({ status: e.target.value as Form["status"] })}>
            <option value="open">Open: students can apply</option><option value="closed">Closed: no new applications</option>
          </select>
        </Field>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : isNew ? "Post job" : "Save changes"}</Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

function CheckGroup<T extends string | number>({ label, options, value, onToggle }: { label: string; options: T[]; value: T[]; onToggle: (v: T) => void }) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-semibold text-muted">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o} className={cn("inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm",
            value.includes(o) ? "border-brand bg-brand-soft text-brand-text" : "border-border text-muted hover:bg-surface-hover")}>
            <input type="checkbox" className="accent-[var(--color-brand)]" checked={value.includes(o)} onChange={() => onToggle(o)} />
            {o}
          </label>
        ))}
      </div>
    </div>
  );
}
