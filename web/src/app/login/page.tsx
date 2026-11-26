import { PageHeader } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

type Search = { next?: string; need?: string; as?: string };

export default async function Login({ searchParams }: { searchParams: Promise<Search> }) {
  const { next, need, as } = await searchParams;
  const role = need === "cell" ? "cell" : "student";
  return (
    <>
      <PageHeader eyebrow="PlaceIQ" title="Sign in" />
      <LoginForm next={next ?? ""} initialRole={role} wrongRole={as === "student" || as === "cell" ? as : null} />
    </>
  );
}
