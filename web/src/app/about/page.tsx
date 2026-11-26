import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import {
  BarChart3, Brain, Briefcase, ClipboardCheck, ClipboardList, FileText, Gauge, Lock, Map, Scale, SlidersHorizontal, Sparkles, Tags, UserCheck, Users,
} from "lucide-react";
import { ButtonLink, Card, CardTitle, PageHeader } from "@/components/ui";
import { DataSources } from "./data-sources";

export const metadata = { title: "About" };

type Feature = { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; href: string; body: string; points: string[] };

const STUDENT: Feature[] = [
  {
    icon: Gauge, title: "Readiness report", href: "/readiness",
    body: "Your chance of campus placement, estimated by a machine-learning model from your CGPA, internships, projects, certifications, backlogs and skills.",
    points: ["A clear readiness band: low, moderate or high", "Shows which factors raise or lower your chance (SHAP explanations)", "Ranked advice, each step with how much it would raise your estimate"],
  },
  {
    icon: SlidersHorizontal, title: "What-if simulator", href: "/what-if",
    body: "Change your profile and see your estimate update instantly, before you put in the effort.",
    points: ["Try one more internship, a higher CGPA or clearing a backlog", "See the gain or loss against your current estimate", "Find the change that helps the most"],
  },
  {
    icon: Map, title: "Personal roadmap", href: "/roadmap",
    body: "Turns the advice into a step-by-step plan you can follow.",
    points: ["Steps ordered by how much they help", "The expected estimate after each step", "Only things you can actually change"],
  },
  {
    icon: Briefcase, title: "Job Finder", href: "/jobs",
    body: "Browse the openings your placement cell posts, each matched against your profile.",
    points: ["Eligibility checked first: CGPA, backlogs, branch and batch", "Skill match: Eligible, Almost there or Stretch, with the skills you're missing", "Save jobs and apply with your CV in a couple of clicks"],
  },
  {
    icon: ClipboardList, title: "My applications", href: "/applications",
    body: "Track every job you've applied to in one place.",
    points: ["Live status: applied, shortlisted, interview, selected", "Withdraw while it's still at Applied", "Every application listed with its job and date"],
  },
  {
    icon: FileText, title: "Profile & CV skill extraction", href: "/profile",
    body: "Upload your CV as a PDF and PlaceIQ picks out your skills automatically, so you don't have to type them.",
    points: ["Recognises 321 skills, including common spelling variants", "You review and edit everything it finds", "Your profile stays in your browser; the CV is never stored"],
  },
];

const CELL: Feature[] = [
  {
    icon: BarChart3, title: "Batch dashboard", href: "/cell",
    body: "The readiness of the whole batch at a glance, from anonymised profiles students chose to share.",
    points: ["Readiness of each batch year and at-risk students", "Mean estimate by branch", "What holds the batch back and which skills are missing", "Export to CSV"],
  },
  {
    icon: Briefcase, title: "Job postings", href: "/cell/jobs",
    body: "Post openings with their eligibility rules and required skills; students see them on their Job Finder.",
    points: ["Minimum CGPA, maximum backlogs, branches and batch", "Required skills drive each student's match", "Close a job when hiring ends"],
  },
  {
    icon: UserCheck, title: "Applicants", href: "/cell/applicants",
    body: "Review everyone who applied to a job, best skill match first.",
    points: ["Academics, matched and missing skills for each applicant", "Move applicants through Shortlisted, Interview and Selected", "Download CVs and export the list to CSV"],
  },
  {
    icon: Users, title: "Training groups", href: "/cell",
    body: "Groups students by the gap that lowers their estimate the most, so each workshop reaches the right people.",
    points: ["Group size, share of batch and students at risk", "A suggested session for every group", "Only gaps students can change"],
  },
  {
    icon: Scale, title: "Fairness audit", href: "/cell/evaluation",
    body: "Checks that the model works equally well for every branch and gender, instead of assuming it.",
    points: ["True and false positive rates per group", "Gaps between groups highlighted", "Gender is used only for the audit, never for predictions"],
  },
  {
    icon: Brain, title: "Model training", href: "/cell/model",
    body: "Train on your college's own anonymised placement records and deploy the new model.",
    points: ["Logistic regression and random forest, cross-validated", "ROC-AUC with confidence intervals, ROC, calibration and confusion-matrix charts", "Figures saved ready for the project report"],
  },
  {
    icon: ClipboardCheck, title: "Evaluation experiment", href: "/cell/evaluation",
    body: "Answers the research question: does resume-to-job similarity predict placement as well as an outcome-trained model?",
    points: ["TF-IDF and Sentence-BERT similarity baselines vs the classifier", "Side-by-side AUC comparison", "Skill-extraction accuracy: precision, recall and F1"],
  },
  {
    icon: Tags, title: "Resume annotation", href: "/cell/annotate",
    body: "Label the skills in sample resumes to measure how accurately PlaceIQ extracts them.",
    points: ["Builds the ground truth for the extraction study", "Extractor suggestions kept separate to avoid bias", "Contact details removed before saving"],
  },
];

const STEPS = [
  { n: "1", title: "Sign in and build your profile", body: "Register with your roll number, then enter your academics or upload your CV; skills are extracted for you." },
  { n: "2", title: "Get your estimate", body: "The model predicts your placement chance and explains why." },
  { n: "3", title: "Improve and apply", body: "Follow your roadmap, then apply to jobs you're eligible for and track the result." },
];

function FeatureCard({ f }: { f: Feature }) {
  const Icon = f.icon;
  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand-text"><Icon className="size-5" aria-hidden /></span>
        <h3 className="text-base font-semibold text-foreground">{f.title}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">{f.body}</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted">
        {f.points.map((p) => <li key={p}>{p}</li>)}
      </ul>
      <Link href={f.href} className="mt-auto pt-4 text-sm font-medium text-brand-text hover:underline">Open {f.title.toLowerCase()} →</Link>
    </Card>
  );
}

export default function About() {
  return (
    <>
      <PageHeader eyebrow="About" title="What PlaceIQ does" aside={<ButtonLink href="/profile">Get started</ButtonLink>}>
        PlaceIQ predicts how ready you are for campus placement, explains what&apos;s holding you back, shows the fastest way to
        improve, and connects you to the jobs your placement cell posts. Placement cells get a live view of the whole batch and every applicant.
      </PageHeader>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <Card key={s.n} accent>
            <p className="font-display text-3xl text-brand-text">{s.n}</p>
            <h3 className="mt-1 text-base font-semibold text-foreground">{s.title}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">{s.body}</p>
          </Card>
        ))}
      </div>

      <h2 className="mt-10 flex items-center gap-2 font-display text-2xl text-headline"><Sparkles className="size-5 text-brand-text" aria-hidden /> For students</h2>
      <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{STUDENT.map((f) => <FeatureCard key={f.title} f={f} />)}</div>

      <h2 className="mt-10 flex items-center gap-2 font-display text-2xl text-headline"><Lock className="size-5 text-brand-text" aria-hidden /> For the placement cell</h2>
      <p className="mt-1 text-sm text-muted">Password-protected tools for placement officers. Students never see this menu.</p>
      <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{CELL.map((f) => <FeatureCard key={f.title} f={f} />)}</div>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle>Why PlaceIQ is different</CardTitle>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
            <li><strong className="text-foreground">Learns from outcomes:</strong> trained on who got placed, not on how closely a CV matches a job ad.</li>
            <li><strong className="text-foreground">Explains every estimate:</strong> each prediction is broken down factor by factor, so the advice is never a black box.</li>
            <li><strong className="text-foreground">Private by design:</strong> profiles stay in your browser, CVs are never saved, and sharing with the cell is opt-in and anonymised.</li>
            <li><strong className="text-foreground">Fairness is tested:</strong> accuracy is measured for every group, not assumed.</li>
          </ul>
        </Card>
        <Card id="data">
          <CardTitle>Training data</CardTitle>
          <DataSources />
        </Card>
      </div>
    </>
  );
}
