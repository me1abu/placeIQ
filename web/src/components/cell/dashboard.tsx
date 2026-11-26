"use client";
// PlaceIQ placement cell: batch readiness, training groups, batch drag factors, skill coverage.
import { useCallback, useEffect, useState } from "react";
import { adminApi, downloadBlob, featureLabel, type CohortSummary, type Profile, type TrainingGroup } from "@/lib/client";
import { Badge, Bars, Button, Notice, Section, Table, Tile, Tiles, inputCls, pct } from "@/components/ui";

const REQUIRED = ["branch", "cgpa", "active_backlogs", "internships", "projects", "certifications", "skills"];

/** Minimal CSV parser (quoted fields, commas, CRLF). Enough for the records template. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  if (!rows.length) return [];
  const [header, ...body] = rows;
  const keys = header.map((h) => h.trim().replace(/^﻿/, "").toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const SESSIONS: Record<string, string> = {
  cgpa: "Academic mentoring and exam support",
  active_backlogs: "Backlog-clearing support (remedial classes, re-exam planning)",
  internships: "Internship drive, alumni referrals, short industry projects",
  projects: "Project-building workshop / hackathon",
  certifications: "Guided certification track",
  n_skills: "Skill bootcamp and resume skills review",
  none: "Interview and aptitude practice",
};
const session = (f: string) => SESSIONS[f] ?? (f.startsWith("skills_") ? `Bootcamp: ${f.slice(7).replace(/_/g, " ")}` : "");

function TrainingGroups({ groups, n }: { groups: TrainingGroup[]; n: number }) {
  if (!groups?.length) return null;
  return (
    <Section title="Training groups">
      <p className="mb-3 text-xs text-faint">Each student is placed in the group of the factor that lowers their estimate the most (from their SHAP explanation), counting only factors they can change. Big groups are where one session reaches the most students.</p>
      <Table head={["Biggest gap", "Students", "Share of batch", "At risk", "Mean estimate", "Suggested session"]}>
        {groups.map((g) => (
          <tr key={g.feature}>
            <td>{g.feature === "none" ? <em>No major gap</em> : featureLabel(g.feature)}</td>
            <td className="text-right tabular-nums">{g.students}</td>
            <td className="min-w-32">
              <div className="flex items-center gap-2" title={`${g.students} of ${n} students`}>
                <div className={`h-2.5 rounded-r ${g.feature === "none" ? "bg-border" : "bg-brand"}`} style={{ width: `max(${g.share * 70}%, 2px)` }} />
                <span className="text-xs tabular-nums text-muted">{pct(g.share)}</span>
              </div>
            </td>
            <td className="text-right tabular-nums">{g.at_risk}</td>
            <td className="text-right tabular-nums">{pct(g.mean_probability)}</td>
            <td className="text-xs text-muted">{session(g.feature)}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-faint">The CSV export includes each student&apos;s group (<code>primary_gap</code>), so sessions can be scheduled by hashed ID.</p>
    </Section>
  );
}

export function CellDashboard({ taxonomy }: { taxonomy: Record<string, string> }) {
  const [summary, setSummary] = useState<CohortSummary | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<{ batch_year: number; count: number }[]>([]);
  const [year, setYear] = useState<number | null>(null);

  const loadBatches = useCallback(async () => {
    try {
      const b = await adminApi.batches();
      setBatches(b);
      setYear((y) => (y && b.some((x) => x.batch_year === y) ? y : b[0]?.batch_year ?? null));
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  const loadYear = useCallback(async (y: number) => {
    setError(null); setNote(null); setBusy(true);
    try { setSummary(await adminApi.cohortFromDb(y)); setLabel(`Batch ${y} (profiles shared by students)`); }
    catch (e) { setError((e as Error).message); setSummary(null); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (year) loadYear(year); }, [year, loadYear]);

  async function handleFile(file: File) {
    setError(null); setNote(null); setBusy(true);
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new Error("The CSV has no data rows.");
      const missingCols = REQUIRED.filter((c) => !(c in rows[0]));
      if (missingCols.length) throw new Error(`CSV is missing columns: ${missingCols.join(", ")}`);
      const unknown = new Set<string>();
      const profiles: Profile[] = rows.map((r) => ({
        branch: r.branch, cgpa: Number(r.cgpa), active_backlogs: Number(r.active_backlogs), internships: Number(r.internships),
        projects: Number(r.projects), certifications: Number(r.certifications),
        skills: (r.skills ?? "").split(";").map((s) => s.trim().toLowerCase()).filter((s) => {
          if (!s) return false;
          if (!(s in taxonomy)) { unknown.add(s); return false; }
          return true;
        }),
      }));
      const bad = profiles.findIndex((p) => !p.branch || [p.cgpa, p.active_backlogs, p.internships, p.projects, p.certifications].some(Number.isNaN));
      if (bad >= 0) throw new Error(`Row ${bad + 2} has a missing or non-numeric value.`);
      setSummary(await adminApi.cohortFromProfiles(profiles));
      setLabel(`Uploaded file: ${file.name}`);
      if (unknown.size) setNote(`Ignored ${unknown.size} skill name(s) not in the taxonomy: ${[...unknown].slice(0, 8).join(", ")}${unknown.size > 8 ? "…" : ""}`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function exportCsv() {
    if (!year) return;
    try { downloadBlob(await adminApi.exportBatch(year), `placeiq_batch_${year}.csv`); } catch (e) { setError((e as Error).message); }
  }
  async function deleteBatch() {
    if (!year) return;
    const count = batches.find((b) => b.batch_year === year)?.count ?? 0;
    if (!window.confirm(`Permanently delete all ${count} shared profiles in batch ${year}? This cannot be undone.`)) return;
    try { await adminApi.deleteBatch(year); setSummary(null); await loadBatches(); } catch (e) { setError((e as Error).message); }
  }

  const bands = summary?.bands ?? {};
  const n = summary?.n_students ?? 0;
  const share = (k: "ready" | "borderline" | "at_risk") => (n ? pct((bands[k] ?? 0) / n) : "0%");

  return (
    <>
      <Section title="Batch readiness">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted">Shared batch</h3>
            {batches.length === 0 ? <p className="text-sm text-faint">No student has shared a profile yet. Students share from their Profile page.</p> : (
              <>
                <div className="flex gap-2">
                  <select aria-label="Batch year" className={inputCls} value={year ?? ""} onChange={(e) => setYear(Number(e.target.value))}>
                    {batches.map((b) => <option key={b.batch_year} value={b.batch_year}>Batch {b.batch_year} ({b.count} students)</option>)}
                  </select>
                  <Button variant="outline" onClick={() => year && loadYear(year)} disabled={busy}>Refresh</Button>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
                  <Button variant="outline" size="sm" className="text-red-700 dark:text-red-400" onClick={deleteBatch}>Delete batch…</Button>
                </div>
              </>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted">Or analyse a CSV file</h3>
            <label className="block cursor-pointer rounded-xl border-2 border-dashed border-border p-4 text-center text-sm text-muted hover:border-brand">
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
              {busy ? "Scoring…" : "Choose a CSV in the records-template layout. It's processed in memory and not saved."}
            </label>
          </div>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {note && <p className="mt-2 text-xs text-faint">{note}</p>}
      </Section>

      {summary && (
        <>
          <p className="mt-5 text-xs text-faint">Showing: <strong className="text-muted">{label}</strong></p>
          {!!summary.synthetic_records && <Notice>This batch contains {summary.synthetic_records} synthetic demo profiles. Delete the batch before real use.</Notice>}
          <Tiles>
            <Tile label="Students" value={n} />
            <Tile label="Mean estimate" value={pct(summary.mean_probability)} />
            <Tile label={<><span className="text-emerald-800 dark:text-emerald-400">●</span> ✓ Ready (≥ 70%)</>} value={bands.ready ?? 0} hint={share("ready")} />
            <Tile label={<><span className="text-amber-800 dark:text-amber-400">●</span> ! Borderline</>} value={bands.borderline ?? 0} hint={share("borderline")} />
            <Tile label={<><span className="text-red-700 dark:text-red-400">●</span> ✕ At risk (&lt; 40%)</>} value={bands.at_risk ?? 0} hint={share("at_risk")} />
          </Tiles>
          <TrainingGroups groups={summary.training_groups} n={n} />
          <div className="grid gap-x-5 lg:grid-cols-2">
            <Section title="What holds the batch back">
              <p className="mb-3 text-xs text-faint">Average amount each factor lowers students&apos; estimates (log-odds). A longer bar means a bigger drag.</p>
              <Bars tone="neg" fmt={(v) => `−${v.toFixed(2)}`}
                items={summary.top_negative_factors.map((f) => ({ label: featureLabel(f.feature), value: -f.mean_contribution, title: `Average drag −${(-f.mean_contribution).toFixed(3)} per student` }))} />
            </Section>
            <Section title="Mean estimate by branch">
              <p className="mb-3 text-xs text-faint">Average placement estimate per branch (student count in brackets).</p>
              <Bars max={1} fmt={pct} items={summary.by_branch.map((b) => ({ label: `${b.branch} (${b.count})`, value: b.mean }))} />
            </Section>
          </div>
          <Section title="Skill coverage">
            <p className="mb-3 text-xs text-faint">Share of students listing each skill (top 15; bar = % of the batch). Skills recruiters ask for that are missing here are gaps across the batch.</p>
            <Bars max={1} fmt={pct} items={summary.skill_coverage.slice(0, 15).map((s) => ({ label: s.skill, value: s.share, title: `${Math.round(s.share * n)} of ${n} students` }))} />
          </Section>
        </>
      )}
      <StudentAccounts />
    </>
  );
}

/** Forgotten passwords: the cell deletes the student's sign-in so they can create it again. */
function StudentAccounts() {
  const [count, setCount] = useState<number | null>(null);
  const [roll, setRoll] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => { adminApi.accountCount().then((r) => setCount(r.accounts)).catch(() => {}); }, []);

  async function reset() {
    const r = roll.trim().toUpperCase();
    if (r.length < 3) { setMsg({ tone: "error", text: "Enter the student's roll number." }); return; }
    if (!confirm(`Reset the sign-in for ${r}? They will create a new password the next time they sign in. Their shared profile is kept.`)) return;
    try {
      await adminApi.resetAccount(r);
      setMsg({ tone: "ok", text: `Sign-in for ${r} was reset. Ask them to choose "Create a student account" again.` });
      setRoll("");
      setCount((c) => (c === null ? c : Math.max(0, c - 1)));
    } catch (e) { setMsg({ tone: "error", text: (e as Error).message }); }
  }

  return (
    <Section title="Student accounts">
      <p className="mb-3 text-xs text-faint">
        {count === null ? "" : `${count} student account${count === 1 ? "" : "s"} registered. `}
        If a student forgets their password, reset their sign-in here.
      </p>
      <div className="flex max-w-md gap-2">
        <input aria-label="Student roll number" placeholder="Roll / enrolment number" className={inputCls} value={roll} onChange={(e) => setRoll(e.target.value)} />
        <Button variant="outline" onClick={reset}>Reset sign-in</Button>
      </div>
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
    </Section>
  );
}
