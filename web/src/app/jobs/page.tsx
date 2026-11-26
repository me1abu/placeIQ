import { PageHeader } from "@/components/ui";
import { JobsView } from "./jobs-view";

export const metadata = { title: "Job Finder" };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Student / Job Finder" title="Job Finder">
        Jobs and internships your placement cell has posted, with how well your profile matches each one. Apply in one step.
      </PageHeader>
      <JobsView />
    </>
  );
}
