import { PageHeader } from "@/components/ui";
import { ApplicationsView } from "./applications-view";

export const metadata = { title: "My applications" };

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Student / My applications" title="My applications">
        Track the jobs you applied to and the ones you saved. The placement cell updates each application&apos;s status as it moves forward.
      </PageHeader>
      <ApplicationsView />
    </>
  );
}
