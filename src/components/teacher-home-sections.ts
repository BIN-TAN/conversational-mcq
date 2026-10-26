import { teacherPrimaryNavItems } from "./teacher-primary-nav-items";

/** The workspace sections shown on the instructor home page, in navigation order. */
export const teacherHomeSections = teacherPrimaryNavItems
  .filter((item) => String(item.href) !== "/teacher")
  .map((item) => ({ href: item.href, label: item.label }));
