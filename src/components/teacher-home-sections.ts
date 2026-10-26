import { teacherPrimaryNavItems } from "./teacher-primary-nav-items";

/** What each part of the instructor workspace is for, shown on the instructor home page. */
export const teacherHomeSectionDescriptions: Record<string, string> = {
  "/teacher/dashboard":
    "Results for each mini test: an overview of students' understanding, their attempts compared, how each item went, and the instructor report.",
  "/teacher/content":
    "The assessment library. Create mini tests and arrange them by category, prepare and review items with the assistant, and publish them to students.",
  "/teacher/students":
    "Add students one at a time or from a roster, and reset their passwords.",
  "/teacher/sessions":
    "Each student's attempts: their answers and explanations, and their conversations with the tutor.",
  "/teacher/data":
    "Export the research data, and enter the course outcomes that go with it.",
  "/teacher/system/llm":
    "Which AI model each part of the system uses, and whether its recent calls succeeded."
};

/** The workspace sections in navigation order, without the home page itself. */
export const teacherHomeSections = teacherPrimaryNavItems
  .filter((item) => item.href !== "/teacher")
  .map((item) => ({ href: item.href, label: item.label, description: teacherHomeSectionDescriptions[item.href] ?? "" }));

/** The usual order of work for a mini test, as plain steps with the section each happens in. */
export const teacherHomeSteps = [
  { href: "/teacher/content", text: "Prepare a mini test in Assessment management: write or import its items with the assistant, review every item and its key, then publish it." },
  { href: "/teacher/students", text: "Add your students in Student accounts, so they can sign in." },
  { href: "/teacher/sessions", text: "Follow students' attempts and conversations in Student sessions while the mini test is open." },
  { href: "/teacher/dashboard", text: "Look at the results for each mini test in the Dashboard." },
  { href: "/teacher/data", text: "Export the research data in Data and outcomes when you need it." }
] as const;
