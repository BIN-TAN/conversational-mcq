/**
 * The order of mini tests in the assessment library (Assessment management), for other pages
 * that list mini tests, such as the dashboard's mini-test selector. It follows the library's own
 * rules (assessment-list-client.tsx, sort mode "folder_order" and groupAssessmentsByFolder):
 * categories by their order, then by name, with mini tests without a category last; within a
 * category, mini tests by their order, then by title.
 */
export const UNFILED_ASSESSMENT_FOLDER = "Unfiled";

export type LibraryOrderedAssessment = {
  title: string;
  folder_label: string | null;
  folder_order_index: number;
  assessment_order_index: number;
  /**
   * Optional. Archived mini tests are hidden from the library's default view and are not
   * renumbered when the instructor saves a new order, so their stored order can be stale. They
   * never decide where a category goes and come after the active mini tests of their category.
   */
  status?: string | null;
};

export function assessmentLibraryFolder(assessment: Pick<LibraryOrderedAssessment, "folder_label">) {
  return assessment.folder_label?.trim() || UNFILED_ASSESSMENT_FOLDER;
}

const isArchived = (assessment: Pick<LibraryOrderedAssessment, "status">) => assessment.status === "archived";

export function orderLikeAssessmentLibrary<T extends LibraryOrderedAssessment>(assessments: T[]): T[] {
  const sorted = [...assessments].sort((left, right) =>
    Number(isArchived(left)) - Number(isArchived(right)) ||
    left.folder_order_index - right.folder_order_index ||
    assessmentLibraryFolder(left).localeCompare(assessmentLibraryFolder(right)) ||
    left.assessment_order_index - right.assessment_order_index ||
    left.title.localeCompare(right.title));
  const groups = new Map<string, T[]>();
  for (const assessment of sorted) {
    const folder = assessmentLibraryFolder(assessment);
    groups.set(folder, [...(groups.get(folder) ?? []), assessment]);
  }
  // A category's place comes from its active mini tests, as in the library; a category that
  // holds only archived mini tests goes after the others (Unfiled stays last).
  const position = (group: T[]) => {
    const active = group.filter((assessment) => !isArchived(assessment));
    return active.length ? Math.min(...active.map((assessment) => assessment.folder_order_index)) : Number.MAX_SAFE_INTEGER;
  };
  return [...groups.entries()]
    .sort(([leftFolder, left], [rightFolder, right]) => {
      if (leftFolder === UNFILED_ASSESSMENT_FOLDER && rightFolder !== UNFILED_ASSESSMENT_FOLDER) return 1;
      if (rightFolder === UNFILED_ASSESSMENT_FOLDER && leftFolder !== UNFILED_ASSESSMENT_FOLDER) return -1;
      return position(left) - position(right) || leftFolder.localeCompare(rightFolder);
    })
    .flatMap(([, group]) => group);
}
