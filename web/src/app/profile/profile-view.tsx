"use client";
import { ArrowRight, FileText, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { SkillPicker } from "@/components/skill-picker";
import { EngineStatus, Loading } from "@/components/status";
import { Button, ButtonLink, Field, inputClass, Notice, Section } from "@/components/ui";
import { useStudent } from "@/components/use-student";
import { api, BRANCHES, profileApi, toEngineProfile, type Draft, type StoredProfile } from "@/lib/client";

type NumKey = "cgpa" | "active_backlogs" | "internships" | "projects" | "certifications";
const NUMS: { key: NumKey; label: string; step: number; max: number; fromCv: boolean }[] = [
  { key: "cgpa", label: "CGPA (out of 10)", step: 0.01, max: 10, fromCv: true },
  { key: "active_backlogs", label: "Active backlogs", step: 1, max: 30, fromCv: false },
  { key: "internships", label: "Internships", step: 1, max: 20, fromCv: true },
  { key: "projects", label: "Projects", step: 1, max: 30, fromCv: true },
  { key: "certifications", label: "Certifications", step: 1, max: 50, fromCv: true },
];
const YEAR = new Date().getFullYear();
type Form = { name: string; branch: string; batch_year: string; skills: string[] } & Record<NumKey, string>;

function toForm(p: StoredProfile | null): Form {
  const s = (v: number | undefined) => (v === undefined || v === null ? "" : String(v));
  return {
    name: p?.name ?? "", branch: p?.branch ?? "", batch_year: String(p?.batch_year ?? YEAR),
    cgpa: s(p?.cgpa), active_backlogs: s(p?.active_backlogs), internships: s(p?.internships),
    projects: s(p?.projects), certifications: s(p?.certifications), skills: p?.skills ?? [],
  };
}

export function ProfileView() {
  const st = useStudent();
  const [form, setForm] = useState<Form | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cvText, setCvText] = useState("");
  const [busy, setBusy] = useState<"" | "parse" | "save">("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);

  useEffect(() => { if (!st.loading && form === null) setForm(toForm(st.stored)); }, [st.loading, st.stored, form]);

  function applyDraft(d: Draft) {
    setDraft(d);
    setForm((f) => {
      const base = f ?? toForm(null);
      const v = (k: NumKey) => (d[k] === null || d[k] === undefined ? base[k] : String(d[k]));
      return { ...base, branch: d.branch ?? base.branch, cgpa: v("cgpa"), active_backlogs: v("active_backlogs"),
        internships: v("internships"), projects: v("projects"), certifications: v("certifications"),
        skills: d.skills.length ? d.skills : base.skills };
    });
    const missing = d.needs_review.map((k) => k.replace(/_/g, " "));
    setMsg({ tone: "info", text: `Read ${d.skills.length} skills from your CV.${missing.length ? ` Please fill in: ${missing.join(", ")}.` : ""} Check everything, then save.` });
  }

  async function onPdf(file: File) {
    setBusy("parse"); setMsg(null);
    try { applyDraft((await api.parse(file)).draft); } catch (e) { setMsg({ tone: "error", text: (e as Error).message }); } finally { setBusy(""); }
  }
  async function onPaste() {
    if (cvText.trim().length < 20) { setMsg({ tone: "error", text: "Paste your CV text first." }); return; }
    setBusy("parse"); setMsg(null);
    try { applyDraft((await api.parseText(cvText)).draft); } catch (e) { setMsg({ tone: "error", text: (e as Error).message }); } finally { setBusy(""); }
  }

  const missing = form ? [!form.branch && "branch", ...NUMS.filter((n) => form[n.key] === "").map((n) => n.key)].filter(Boolean) as string[] : [];
  const review = new Set(draft?.needs_review ?? []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (missing.length) { setMsg({ tone: "error", text: `Fill in: ${missing.join(", ").replace(/_/g, " ")}.` }); return; }
    setBusy("save"); setMsg(null);
    try {
      await profileApi.save({
        name: form.name || undefined, branch: form.branch, batch_year: Number(form.batch_year),
        cgpa: Number(form.cgpa), active_backlogs: Number(form.active_backlogs), internships: Number(form.internships),
        projects: Number(form.projects), certifications: Number(form.certifications), skills: form.skills,
      });
      setMsg({ tone: "ok", text: "Saved. Your readiness report is up to date." });
      st.reload();
    } catch (err) { setMsg({ tone: "error", text: (err as Error).message }); } finally { setBusy(""); }
  }

  if (st.loading || !form) return <Loading />;
  const complete = toEngineProfile(st.stored);
  return (
    <>
      <EngineStatus health={st.health} loading={st.loading} />

      <Section title="1. Read your CV">
        <p className="text-sm text-muted">Upload a PDF or paste your CV. It&apos;s read on this computer to pre-fill the form below, and never stored.</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-5 text-center text-sm text-muted hover:border-brand">
            <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={!st.health || busy !== ""}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onPdf(f); e.target.value = ""; }} />
            <Upload className="size-5 text-brand-text" />
            {busy === "parse" ? "Reading your CV…" : <>Upload a PDF <span className="text-xs text-faint">(up to 5 MB)</span></>}
          </label>
          <div className="flex flex-col gap-2">
            <label htmlFor="cv-text" className="text-xs font-semibold text-muted">Or paste CV text (plain or Markdown)</label>
            <textarea id="cv-text" rows={5} value={cvText} onChange={(e) => setCvText(e.target.value)} className={`${inputClass} font-mono text-xs`} placeholder="Paste your CV here" />
            <Button variant="outline" onClick={onPaste} disabled={!st.health || busy !== ""} className="self-start"><FileText className="size-4" />Read pasted text</Button>
          </div>
        </div>
      </Section>

      {msg && <Notice tone={msg.tone} className="mt-5">{msg.text}</Notice>}

      <Section title="2. Confirm your details">
        <p className="text-sm text-muted">Check every field: the estimate is only as good as what you confirm. Highlighted fields weren&apos;t found in your CV.</p>
        <form onSubmit={save} className="mt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Name (optional, shown only to you)" htmlFor="name"><input id="name" className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Branch" htmlFor="branch" review={review.has("branch")}>
              <select id="branch" className={inputClass} value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })}>
                <option value="">Select…</option>{BRANCHES.map((b) => <option key={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="Graduating batch" htmlFor="batch">
              <select id="batch" className={inputClass} value={form.batch_year} onChange={(e) => setForm({ ...form, batch_year: e.target.value })}>
                {[0, 1, 2, 3, 4].map((d) => <option key={d}>{YEAR + d}</option>)}
              </select>
            </Field>
            {NUMS.map(({ key, label, step, max, fromCv }) => (
              <Field key={key} label={label} htmlFor={key} review={review.has(key) || (!!draft && !fromCv && form[key] === "")}
                hint={draft && fromCv && !review.has(key) ? "From your CV" : undefined}>
                <input id={key} type="number" min={0} max={max} step={step} className={inputClass} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </Field>
            ))}
          </div>
          <div className="mt-4">
            <SkillPicker taxonomy={st.taxonomy} value={form.skills} onChange={(skills) => setForm({ ...form, skills })} evidence={draft?.skill_evidence} idPrefix="profile-skill" />
            <p className="mt-1 text-xs text-faint">Remove anything you can&apos;t back up in an interview. &quot;(check)&quot; marks a skill matched from a likely typo.</p>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy !== ""}>{busy === "save" ? "Saving…" : "Save my profile"}</Button>
            {complete && <ButtonLink href="/readiness" variant="ghost">View my report <ArrowRight className="size-4" /></ButtonLink>}
            {missing.length > 0 && <span className="text-xs text-faint">Still missing: {missing.join(", ").replace(/_/g, " ")}</span>}
          </div>
        </form>
      </Section>

      <ShareSection profileReady={!!complete} defaultYear={Number(form.batch_year)} />
    </>
  );
}

function ShareSection({ profileReady, defaultYear }: { profileReady: boolean; defaultYear: number }) {
  const [roll, setRoll] = useState("");
  // Sharing is tied to the roll number the student signed in with.
  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" }).then((r) => r.json())
      .then((s: { roll: string | null }) => { if (s.roll) setRoll(s.roll); }).catch(() => {});
  }, []);
  const [year, setYear] = useState(String(defaultYear));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function run(kind: "save" | "withdraw") {
    setMsg(null);
    if (roll.trim().length < 3) { setMsg({ tone: "error", text: "Enter your roll / enrolment number." }); return; }
    if (kind === "save" && !consent) { setMsg({ tone: "error", text: "Tick the consent box to share your profile." }); return; }
    setBusy(true);
    try {
      if (kind === "save") {
        const p = toEngineProfile(await profileApi.get());
        if (!p) throw new Error("Save a complete profile first.");
        const r = await api.saveStudent(roll.trim(), Number(year), p);
        setMsg({ tone: "ok", text: r.updated ? "Your shared profile was updated." : "Shared with the placement cell. Thank you." });
      } else {
        await api.withdrawStudent(roll.trim(), Number(year));
        setMsg({ tone: "ok", text: "Your shared profile has been deleted." });
      }
    } catch (e) { setMsg({ tone: "error", text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <Section title="3. Share with the placement cell (optional)" id="share">
      <p className="text-sm text-muted">Adds your confirmed profile to your batch&apos;s dashboard so the placement cell can plan training. Your roll number becomes an irreversible code; your name, contact details and CV are never shared. You can withdraw at any time.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Roll / enrolment number" htmlFor="roll"><input id="roll" readOnly aria-readonly className={inputClass} value={roll} title="The roll number you signed in with" /></Field>
        <Field label="Graduating batch" htmlFor="share-year">
          <select id="share-year" className={inputClass} value={year} onChange={(e) => setYear(e.target.value)}>{[0, 1, 2, 3, 4].map((d) => <option key={d}>{YEAR + d}</option>)}</select>
        </Field>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 accent-[var(--color-brand)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        I consent to sharing my saved profile with my institute&apos;s placement cell for readiness analysis.
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy || !profileReady} onClick={() => run("save")}>Share my profile</Button>
        <Button variant="outline" disabled={busy} onClick={() => run("withdraw")}>Withdraw a shared profile</Button>
      </div>
      {!profileReady && <p className="mt-2 text-xs text-faint">Save a complete profile above before sharing.</p>}
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
    </Section>
  );
}
