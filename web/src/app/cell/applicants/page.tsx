import { CellPage } from "@/components/cell/cell-page";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Applicants" };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Placement cell / Applicants" title="Applicants">
        Students who applied to each job, best skill match first. Update an application&apos;s status and the student sees it on their My applications page.
      </PageHeader>
      <CellPage kind="applicants" />
    </>
  );
}
