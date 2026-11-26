"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type Health } from "@/lib/client";
import { Notice } from "../ui";
import { CellAnnotate } from "./annotate";
import { CellApplicants } from "./applicants";
import { CellDashboard } from "./dashboard";
import { CellEvaluation } from "./evaluation";
import { CellJobs } from "./jobs";
import { CellModel } from "./model";

export type CellKind = "dashboard" | "jobs" | "applicants" | "model" | "evaluation" | "annotate";

/** Loads engine status and the skill taxonomy, then shows one placement-cell tool. */
export function CellPage({ kind }: { kind: CellKind }) {
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [taxonomy, setTaxonomy] = useState<Record<string, string>>({});
  const loadHealth = useCallback(() => api.health().then(setHealth).catch(() => setHealth(null)), []);

  useEffect(() => {
    loadHealth();
    api.taxonomy().then(setTaxonomy).catch(() => {});
  }, [loadHealth]);

  if (health === undefined) return <p role="status" className="mt-5 text-sm text-faint">Loading…</p>;
  if (health === null) return <Notice tone="error" className="mt-5">The PlaceIQ engine isn&apos;t running. Start everything with <code>start.bat</code>.</Notice>;
  return (
    <>
      {kind === "dashboard" && <CellDashboard taxonomy={taxonomy} />}
      {kind === "jobs" && <CellJobs taxonomy={taxonomy} />}
      {kind === "applicants" && <CellApplicants />}
      {kind === "model" && <CellModel onTrained={loadHealth} trainingEnabled={health.training_enabled !== false} />}
      {kind === "evaluation" && <CellEvaluation />}
      {kind === "annotate" && <CellAnnotate taxonomy={taxonomy} />}
    </>
  );
}
