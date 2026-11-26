import { CellPage } from "@/components/cell/cell-page";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Jobs" };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Placement cell / Jobs" title="Jobs and internships">
        Post openings for students to apply to. Set the eligibility rules (CGPA, backlogs, branches, batch) and the skills the job needs; students see how well they match.
      </PageHeader>
      <CellPage kind="jobs" />
    </>
  );
}
