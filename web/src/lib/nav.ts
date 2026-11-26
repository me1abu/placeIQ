import { BarChart3, Briefcase, ClipboardList, LogIn, Users, Brain, ClipboardCheck, FileText, Gauge, Home, Info, Map, SlidersHorizontal, Tags } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export type NavItem = { href: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> };
export type NavRole = "student" | "cell" | "guest";
export type NavGroup = { title: string; items: NavItem[]; roles: NavRole[] };

// One source for the desktop sidebar and the mobile drawer.
export const NAV: NavGroup[] = [
  {
    title: "Student",
    roles: ["student"],
    items: [
      { href: "/", label: "Home", icon: Home },
      { href: "/readiness", label: "Readiness report", icon: Gauge },
      { href: "/what-if", label: "What-if simulator", icon: SlidersHorizontal },
      { href: "/roadmap", label: "Roadmap", icon: Map },
      { href: "/jobs", label: "Job Finder", icon: Briefcase },
      { href: "/applications", label: "My applications", icon: ClipboardList },
      { href: "/profile", label: "My profile & CV", icon: FileText },
    ],
  },
  {
    title: "Placement cell",
    roles: ["cell"],
    items: [
      { href: "/cell", label: "Batch dashboard", icon: BarChart3 },
      { href: "/cell/jobs", label: "Jobs", icon: Briefcase },
      { href: "/cell/applicants", label: "Applicants", icon: Users },
      { href: "/cell/model", label: "Model", icon: Brain },
      { href: "/cell/evaluation", label: "Evaluation", icon: ClipboardCheck },
      { href: "/cell/annotate", label: "Annotate resumes", icon: Tags },
    ],
  },
  {
    title: "",
    roles: ["student", "cell", "guest"],
    items: [{ href: "/about", label: "About PlaceIQ", icon: Info }],
  },
  {
    title: "",
    roles: ["guest"],
    items: [{ href: "/login", label: "Sign in", icon: LogIn }],
  },
];

/** Students never see the placement-cell menu, and the placement cell sees only its own. */
export function navFor(role: NavRole): NavGroup[] {
  return NAV.filter((g) => g.roles.includes(role));
}

export function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/cell") return pathname === "/cell";
  return pathname === href || pathname.startsWith(`${href}/`);
}
