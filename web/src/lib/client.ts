"use client";
// PlaceIQ web client. Types mirror placeiq/api/schemas.py and the engine's responses;
// every engine call goes through the Next proxy at /api/engine/*.

export const BRANCHES = ['CSE', 'IT', 'ECE', 'EEE', 'ME', 'CIVIL'] as const

export interface Profile {
  branch: string
  cgpa: number
  active_backlogs: number
  internships: number
  projects: number
  certifications: number
  skills: string[]
}

export interface Draft {
  branch: string | null
  cgpa: number | null
  active_backlogs: number | null
  internships: number | null
  projects: number | null
  certifications: number | null
  skills: string[]
  skill_evidence: Record<string, string>
  needs_review: string[]
}

export interface Attribution { feature: string; value: number | string; contribution: number }
export interface GuidanceItem { feature: string; value: number; contribution: number; message: string }

export interface Report {
  probability: number
  base_value: number
  attributions: Attribution[]
  guidance: GuidanceItem[]
  companies: { eligible: string[]; ineligible: { name: string; reasons: string[] }[] }
}

export interface Health {
  status: string
  model_loaded: boolean
  training_enabled?: boolean
  model: {
    synthetic_data: boolean | null; trained_at: string | null; n_records: number | null; roc_auc: number | null; indicative_only: boolean | null
    public_data?: boolean; data_sources?: { source: string; rows: number; title?: string; url?: string }[]; data_notes?: string[]; model_type?: string | null
  } | null
}

export interface CohortSummary {
  n_students: number
  mean_probability: number
  bands: Partial<Record<'at_risk' | 'borderline' | 'ready', number>>
  by_branch: { branch: string; count: number; mean: number }[]
  top_negative_factors: { feature: string; mean_contribution: number }[]
  skill_coverage: { skill: string; share: number }[]
  training_groups: TrainingGroup[]
  synthetic_records?: number
}

export interface TrainingGroup {
  feature: string
  students: number
  share: number
  mean_probability: number
  mean_contribution: number
  at_risk: number
  borderline: number
  ready: number
}

export interface WhatIfSuggestion { key: string; label: string; probability: number; delta: number; changes: Partial<Profile> }
export interface WhatIfResult { probability: number; suggestions: WhatIfSuggestion[] }

export interface RoleGap { id: string; title: string; have: string[]; missing: string[]; coverage: number; probability_if_learned?: number; delta_if_learned?: number }
export interface CompanyGap { type: 'branch' | 'cgpa' | 'backlogs' | 'skills'; detail: string; fixable: boolean; options?: string[] }
export interface Roadmap {
  roles: RoleGap[]
  companies: Record<'eligible' | 'near' | 'out_of_reach', { name: string; gaps: CompanyGap[] }[]>
}

export interface FairnessGroup { group: string; n: number; placement_rate: number; mean_predicted: number; auc: number | null; tpr: number | null; fpr: number | null; too_small: boolean }
export interface FairnessAttribute { groups: FairnessGroup[]; auc_gap: number | null; tpr_gap: number | null; fpr_gap: number | null; calibration_gap: number | null; flags: string[]; comparable_groups: number }
export interface Fairness { threshold: number; min_group: number; flag_thresholds: Record<string, number>; attributes: Record<string, FairnessAttribute> }

export interface AucDiff { auc_diff: number; ci95: [number, number]; p_not_better: number }

export interface ModelMetrics {
  n_records: number
  positive_rate: number
  indicative_only: boolean
  synthetic_data: boolean
  source: string
  trained_at: string
  primary_model: string
  models: Record<string, {
    cv_folds: number
    roc_auc_mean: number
    roc_auc_sd: number
    oof_roc_auc: number
    oof_roc_auc_95ci: [number, number]
    classification_report: Record<string, { precision: number; recall: number; 'f1-score': number; support: number }>
    confusion_matrix: number[][]
    accuracy: number
    majority_class_accuracy: number
  }>
  random_forest_vs_logistic: AucDiff
  coefficients: { feature: string; coefficient: number }[]
  baseline_comparison?: {
    n?: number
    skipped?: string
    signals?: Record<string, { roc_auc: number; point_biserial_r: number; p_value: number }>
    classifier_vs_similarity?: Record<string, AucDiff>
  }
  figures?: string[]
  fairness?: Fairness
  public_data?: boolean
  data_sources?: { source: string; rows: number; title?: string; url?: string }[]
  data_notes?: string[]
  model_type?: string
  ensemble_members?: { name: string; rows: number; features: string[] }[]
}

export interface PRF { precision: number; recall: number; f1: number }
export interface ExtractionMetrics {
  n_documents: number
  micro: PRF
  macro_over_documents: PRF
  precision_by_method: Record<string, { correct: number; predicted: number; precision: number }>
  ablation_without_fuzzy: PRF
  top_false_positives: [string, number][]
  top_false_negatives: [string, number][]
  target_f1: number
  meets_target: boolean
  evaluated_at: string
  source: string
  synthetic_data: boolean
}

export interface SkillMatch { skill: string; alias: string; method: string; score: number }
export interface AnnotationSummary { resume_id: string; n_gold: number; annotator: string; updated_at: string | null }
export interface AnnotationDetail { resume_id: string; text: string; gold_skills: string[]; annotator: string; predicted: SkillMatch[] }
export interface Company { name: string; min_cgpa: number; max_active_backlogs: number; branches: string[]; required_skills_any: string[] }

export type JobType = 'full_time' | 'internship'
export interface JobInput {
  company: string
  title: string
  location: string
  job_type: JobType
  salary: string
  description: string
  skills: string[]
  min_cgpa: number
  max_backlogs: number | null
  branches: string[]
  batch_years: number[]
  deadline: string | null
  status: 'open' | 'closed'
}
export interface Job extends JobInput { id: number; accepting: boolean; created_at: string | null; updated_at: string | null; applicants?: Partial<Record<ApplicationStatus, number>> }

export type MatchBand = 'eligible' | 'almost' | 'stretch' | 'not_eligible'
export interface JobMatch { score: number; band: MatchBand; have: string[]; missing: string[]; reasons: string[] }
export type ApplicationStatus = 'applied' | 'shortlisted' | 'interview' | 'selected' | 'rejected'
export interface FeedJob extends JobInput {
  id: number
  accepting: boolean
  posted_at: string | null
  match: JobMatch | null
  saved: boolean
  application_status: ApplicationStatus | null
}
export interface MyApplication {
  job_id: number
  status: ApplicationStatus
  applied_at: string | null
  updated_at: string | null
  match_score: number
  cv_filename: string | null
  shared: { name: string; email: string; phone: string; roll_number: string; batch_year: number | null; branch: string; cgpa: number; active_backlogs: number; skills: string[] }
  job: (JobInput & { id: number; accepting: boolean }) | null
}
export interface SavedJobEntry extends JobInput { id: number; accepting: boolean; saved_at: string | null; match: JobMatch | null; applied: boolean }
export interface Applicant {
  id: number; job_id: number; status: ApplicationStatus; name: string; email: string; phone: string; roll_number: string
  batch_year: number | null; branch: string; cgpa: number; active_backlogs: number; internships: number; projects: number
  certifications: number; skills: string[]; match_score: number; have: string[]; missing: string[]
  has_cv: boolean; cv_filename: string | null; applied_at: string | null; updated_at: string | null
}
export interface ApplicationInput {
  name: string; email: string; phone: string; roll_number: string; batch_year: number | null; consent: boolean; profile: Profile
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`/api/engine${path}`, init)
  } catch {
    throw new ApiError('Cannot reach the PlaceIQ web server.', 0)
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail
        : Array.isArray(body.detail) ? body.detail.map((d: { loc?: string[]; msg: string }) => `${d.loc?.slice(1).join('.') ?? ''} ${d.msg}`.trim()).join('; ')
        : JSON.stringify(body.detail)
    } catch { /* non-JSON error */ }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status)
  }
  return res
}

const call = async <T>(path: string, init?: RequestInit): Promise<T> =>
  (await request(path, init)).json() as Promise<T>

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
const form = (fields: Record<string, string | Blob>): RequestInit => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return { method: 'POST', body: fd }
}

export const api = {
  health: () => call<Health>('/health'),
  taxonomy: () => call<Record<string, string>>('/taxonomy'),
  parse: (file: File) => call<{ draft: Draft; text_preview: string }>('/parse', form({ file })),
  parseText: (text: string) => call<{ draft: Draft }>('/parse-text', json({ text })),
  predict: (p: Profile) => call<Report>('/predict', json(p)),
  score: (profiles: Profile[]) => call<{ probabilities: number[] }>('/score', json({ profiles })),
  whatif: (p: Profile) => call<WhatIfResult>('/whatif', json(p)),
  roadmap: (p: Profile) => call<Roadmap>('/roadmap', json(p)),
  saveStudent: (roll_number: string, batch_year: number, profile: Profile) =>
    call<{ saved: boolean; updated: boolean }>('/students', json({ roll_number, batch_year, consent: true, profile })),
  jobFeed: (profile: Profile | null, batch_year: number | null) => call<FeedJob[]>('/jobs/feed', json({ profile, batch_year })),
  saveJob: (id: number) => call<{ saved: boolean }>(`/jobs/${id}/save`, { method: 'POST' }),
  unsaveJob: (id: number) => call<{ saved: boolean }>(`/jobs/${id}/save`, { method: 'DELETE' }),
  applyJob: (id: number, a: ApplicationInput, cv: File | null) =>
    call<{ applied: boolean; match: JobMatch }>(`/jobs/${id}/apply`, form(cv ? { data: JSON.stringify(a), cv } : { data: JSON.stringify(a) })),
  myJobs: (profile: Profile | null, batch_year: number | null) =>
    call<{ applications: MyApplication[]; saved: SavedJobEntry[] }>('/jobs/mine', json({ profile, batch_year })),
  withdrawApplication: (jobId: number) => call<{ withdrawn: boolean }>(`/jobs/${jobId}/apply`, { method: 'DELETE' }),
  withdrawStudent: (roll_number: string, batch_year: number) =>
    call<{ deleted: boolean }>('/students/withdraw', json({ roll_number, batch_year })),
}

export const adminApi = {
  jobs: () => call<Job[]>('/admin/jobs'),
  createJob: (j: JobInput) => call<Job>('/admin/jobs', json(j)),
  updateJob: (id: number, j: JobInput) => call<Job>(`/admin/jobs/${id}`, json(j, 'PUT')),
  jobApplications: (id: number) => call<{ job: Job; applications: Applicant[] }>(`/admin/jobs/${id}/applications`),
  setApplicationStatus: (appId: number, status: ApplicationStatus) =>
    call<{ id: number; status: ApplicationStatus }>(`/admin/applications/${appId}/status`, json({ status }, 'PUT')),
  applicationCvUrl: (appId: number) => `/api/engine/admin/applications/${appId}/cv`,
  applicationsCsvUrl: (jobId: number) => `/api/engine/admin/jobs/${jobId}/applications/export`,
  deleteJob: (id: number) => call<{ deleted: boolean }>(`/admin/jobs/${id}`, { method: 'DELETE' }),
  accountCount: () => call<{ accounts: number }>('/admin/accounts/count'),
  resetAccount: (roll_number: string) =>
    call<{ reset: boolean }>('/admin/accounts/reset', json({ roll_number })),
  batches: () => call<{ batch_year: number; count: number }[]>('/admin/batches'),
  cohortFromDb: (year: number) => call<CohortSummary>(`/admin/cohort?batch_year=${year}`),
  cohortFromProfiles: (profiles: Profile[]) => call<CohortSummary>('/admin/cohort', json({ profiles })),
  exportBatch: async (year: number) => (await request(`/admin/students/export?batch_year=${year}`)).blob(),
  deleteBatch: (year: number) => call<{ deleted: number }>(`/admin/students?batch_year=${year}`, { method: 'DELETE' }),
  metrics: () => call<{ model: ModelMetrics | null; extraction: ExtractionMetrics | null }>('/admin/metrics'),
  figure: async (name: string) => (await request(`/admin/figures/${name}`)).blob(),
  train: (file: File, primary: string) => call<ModelMetrics>('/admin/train', form({ file, primary })),
  companies: () => call<Company[]>('/admin/companies'),
  annotations: () => call<AnnotationSummary[]>('/admin/annotations'),
  annotation: (id: string) => call<AnnotationDetail>(`/admin/annotations/${encodeURIComponent(id)}`),
  parseForAnnotation: (file: File) => call<{ text: string; predicted: SkillMatch[] }>('/admin/annotations/parse', form({ file })),
  saveAnnotation: (id: string, text: string, gold_skills: string[], annotator: string) =>
    call<{ saved: boolean }>(`/admin/annotations/${encodeURIComponent(id)}`, json({ text, gold_skills, annotator }, 'PUT')),
  deleteAnnotation: (id: string) => call<{ deleted: boolean }>(`/admin/annotations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  evaluateAnnotations: () => call<ExtractionMetrics>('/admin/annotations/evaluate', { method: 'POST' }),
}

export type StoredProfile = Partial<Profile> & { name?: string; batch_year?: number; updated_at?: string }

// The student's confirmed profile lives in this browser only (localStorage), so a deployed
// PlaceIQ never stores anyone's profile on the server. It is kept per signed-in student
// (placeiq_who cookie), so two students sharing a lab computer never see each other's profile.
const LEGACY_KEY = 'placeiq:profile'

function profileKey(): string | null {
  const m = typeof document === 'undefined' ? null : document.cookie.match(/(?:^|;\s*)placeiq_who=([^;]+)/)
  return m && m[1] !== 'cell' ? `placeiq:profile:${m[1]}` : null
}

export const profileApi = {
  get: async (): Promise<StoredProfile | null> => {
    const key = profileKey()
    if (!key) return null
    try {
      let raw = localStorage.getItem(key)
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (legacy !== null) {
        // Profiles saved before sign-in existed belong to whoever signs in first on this browser.
        if (!raw) { localStorage.setItem(key, legacy); raw = legacy }
        localStorage.removeItem(LEGACY_KEY)
      }
      return raw ? (JSON.parse(raw) as StoredProfile) : null
    } catch { return null }
  },
  save: async (p: StoredProfile): Promise<StoredProfile> => {
    const key = profileKey()
    if (!key) throw new ApiError('Sign in as a student to save your profile.', 401)
    const out = { ...p, updated_at: new Date().toISOString() }
    try { localStorage.setItem(key, JSON.stringify(out)) } catch { throw new ApiError('Your browser blocked saving. Allow site storage and try again.', 0) }
    return out
  },
  clear: async (): Promise<void> => {
    const key = profileKey()
    try { if (key) localStorage.removeItem(key) } catch { /* ignore */ }
  },
}

// Name, email and phone a student entered when applying, remembered (in this browser only) for
// their next application.
export type Contact = { name: string; email: string; phone: string }
export const contactApi = {
  get: (): Contact | null => {
    const key = profileKey()
    try { const raw = key && localStorage.getItem(key.replace('profile', 'contact')); return raw ? (JSON.parse(raw) as Contact) : null } catch { return null }
  },
  save: (c: Contact): void => {
    const key = profileKey()
    try { if (key) localStorage.setItem(key.replace('profile', 'contact'), JSON.stringify(c)) } catch { /* ignore */ }
  },
}

const REQUIRED: (keyof Profile)[] = ['branch', 'cgpa', 'active_backlogs', 'internships', 'projects', 'certifications']

/** The stored profile as an engine Profile, or null if any required field is missing. */
export function toEngineProfile(p: StoredProfile | null): Profile | null {
  if (!p) return null
  if (REQUIRED.some((k) => p[k] === undefined || p[k] === null || (typeof p[k] === 'number' && Number.isNaN(p[k])))) return null
  return {
    branch: p.branch!, cgpa: p.cgpa!, active_backlogs: p.active_backlogs!, internships: p.internships!,
    projects: p.projects!, certifications: p.certifications!, skills: p.skills ?? [],
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Readable names for model features (skill categories come in as skills_<category>).
export function featureLabel(f: string): string {
  const fixed: Record<string, string> = {
    cgpa: 'CGPA', active_backlogs: 'Active backlogs', internships: 'Internships', projects: 'Projects',
    certifications: 'Certifications', n_skills: 'Total skills', branch: 'Branch',
  }
  if (fixed[f]) return fixed[f]
  if (f.startsWith('branch_')) return `Branch: ${f.slice(7)}`
  if (f.startsWith('skills_')) {
    const c = f.slice(7).replace(/_/g, ' ')
    return `Skills: ${c.replace(/\b(ml|ai|cs)\b/g, (m) => m.toUpperCase())}`
  }
  return f
}

export const signalLabel: Record<string, string> = {
  oof_logistic_regression: 'PlaceIQ classifier (logistic regression)',
  sim_tfidf: 'Similarity: TF-IDF',
  sim_sbert: 'Similarity: Sentence-BERT',
  sim_hybrid: 'Similarity: hybrid (TF-IDF + SBERT)',
  sim_skill_overlap: 'Similarity: skill overlap',
  sim_llm_fit: 'career-ops LLM job-fit score (1–5, scaled)',
}

export const fmt = {
  pct: (v: number) => `${Math.round(v * 100)}%`,
  n3: (v: number) => v.toFixed(3),
  signed: (v: number, d = 3) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`,
  date: (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString() : '',
}
