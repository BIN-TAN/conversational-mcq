export type TeacherPrimaryNavItem = {
  href: string;
  label: string;
  activePathPrefix: string;
  exact?: boolean;
};

export const teacherPrimaryNavItems = [
  {
    href: "/teacher/dashboard",
    label: "Dashboard",
    activePathPrefix: "/teacher/dashboard",
    exact: true
  },
  {
    href: "/teacher/content",
    label: "Assessment management",
    activePathPrefix: "/teacher/content"
  },
  {
    href: "/teacher/students",
    label: "Student accounts",
    activePathPrefix: "/teacher/students"
  },
  {
    href: "/teacher/sessions",
    label: "Student sessions",
    activePathPrefix: "/teacher/sessions"
  },
  {
    href: "/teacher/data",
    label: "Data and outcomes",
    activePathPrefix: "/teacher/data"
  },
  {
    href: "/teacher/system/llm",
    label: "LLM status",
    activePathPrefix: "/teacher/system/llm"
  }
] as const satisfies readonly TeacherPrimaryNavItem[];
