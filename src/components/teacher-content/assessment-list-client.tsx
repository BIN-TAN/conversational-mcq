"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  GripVertical,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  X
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiRequest, errorFromUnknown } from "./api";
import type { AssessmentSummary, StructuredApiError } from "./types";
import {
  Button,
  ErrorPanel,
  Field,
  LoadingRow,
  PageHeader,
  PrimaryLink,
  StatusBadge,
  SuccessPanel,
  formatDate
} from "./ui";

type AssessmentListResponse = {
  assessments: AssessmentSummary[];
  organization_revision: string;
};

type StatusFilter = "active" | "draft" | "published" | "closed" | "archived" | "all";
type SortMode = "updated_desc" | "title_asc" | "release_asc" | "folder_order";
type AssessmentGroup = { folder: string; assessments: AssessmentSummary[] };

const UNFILED_FOLDER = "Unfiled";

function folderName(assessment: AssessmentSummary) {
  return assessment.folder_label?.trim() || UNFILED_FOLDER;
}

function folderLabelForSave(folder: string) {
  return folder === UNFILED_FOLDER ? null : folder;
}

function folderDropId(folder: string) {
  return `folder:${encodeURIComponent(folder)}`;
}

function folderFromDropId(id: string) {
  return decodeURIComponent(id.slice("folder:".length));
}

function compareOrganizationFolders(left: AssessmentGroup, right: AssessmentGroup) {
  if (left.folder === UNFILED_FOLDER && right.folder !== UNFILED_FOLDER) {
    return 1;
  }

  if (right.folder === UNFILED_FOLDER && left.folder !== UNFILED_FOLDER) {
    return -1;
  }

  const leftIndex = left.assessments[0]?.folder_order_index ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = right.assessments[0]?.folder_order_index ?? Number.MAX_SAFE_INTEGER;

  return leftIndex - rightIndex || left.folder.localeCompare(right.folder);
}

function isClosed(assessment: AssessmentSummary) {
  return Boolean(assessment.close_at && new Date(assessment.close_at) < new Date());
}

function statusMatches(assessment: AssessmentSummary, statusFilter: StatusFilter) {
  if (statusFilter === "all") {
    return true;
  }

  if (statusFilter === "active") {
    return assessment.status !== "archived";
  }

  if (statusFilter === "closed") {
    return assessment.status !== "archived" && isClosed(assessment);
  }

  return assessment.status === statusFilter;
}

function sortAssessments(assessments: AssessmentSummary[], sortMode: SortMode) {
  const copy = [...assessments];

  if (sortMode === "title_asc") {
    return copy.sort((left, right) => left.title.localeCompare(right.title));
  }

  if (sortMode === "release_asc") {
    return copy.sort((left, right) => {
      const leftTime = left.release_at ? new Date(left.release_at).getTime() : Number.MAX_SAFE_INTEGER;
      const rightTime = right.release_at ? new Date(right.release_at).getTime() : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || left.title.localeCompare(right.title);
    });
  }

  if (sortMode === "folder_order") {
    return copy.sort((left, right) => {
      return (
        left.folder_order_index - right.folder_order_index ||
        folderName(left).localeCompare(folderName(right)) ||
        left.assessment_order_index - right.assessment_order_index ||
        left.title.localeCompare(right.title)
      );
    });
  }

  return copy.sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  );
}

function groupAssessmentsByFolder(assessments: AssessmentSummary[]) {
  const groups = new Map<string, AssessmentSummary[]>();

  for (const assessment of sortAssessments(assessments, "folder_order")) {
    const folder = folderName(assessment);
    groups.set(folder, [...(groups.get(folder) ?? []), assessment]);
  }

  return [...groups.entries()]
    .map(([folder, groupAssessments]) => ({ folder, assessments: groupAssessments }))
    .sort(compareOrganizationFolders);
}

function normalizeGroups(groups: AssessmentGroup[]) {
  return groups.flatMap((group, groupIndex) =>
    group.assessments.map((assessment, assessmentIndex) => ({
      ...assessment,
      folder_label: folderLabelForSave(group.folder),
      folder_order_index: groupIndex,
      assessment_order_index: assessmentIndex
    }))
  );
}

function organizationSignature(assessments: AssessmentSummary[]) {
  return JSON.stringify(
    assessments
      .map((assessment) => ({
        id: assessment.assessment_public_id,
        folder: assessment.folder_label?.trim() || null,
        folder_order_index: assessment.folder_order_index,
        assessment_order_index: assessment.assessment_order_index
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  );
}

function activeOrganizationAssessments(assessments: AssessmentSummary[]) {
  return assessments.filter((assessment) => assessment.status !== "archived");
}

function DroppableFolderSection({
  folder,
  children
}: {
  folder: string;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: folderDropId(folder) });

  return (
    <section
      aria-label={`${folder} drop target`}
      className={`overflow-hidden rounded-lg border bg-white shadow-soft ${
        isOver ? "border-accent ring-2 ring-accent-soft" : "border-line"
      }`}
      ref={setNodeRef}
    >
      {children}
    </section>
  );
}

function SortableAssessmentRow({
  assessment,
  folderOptions,
  isBusy,
  onArchive,
  onMoveDown,
  onMoveToFolder,
  onMoveUp,
  onRestore,
  reorderMode
}: {
  assessment: AssessmentSummary;
  folderOptions: string[];
  isBusy: boolean;
  onArchive: (assessment: AssessmentSummary) => void;
  onMoveDown: (assessmentPublicId: string) => void;
  onMoveToFolder: (assessmentPublicId: string, folder: string) => void;
  onMoveUp: (assessmentPublicId: string) => void;
  onRestore: (assessment: AssessmentSummary) => void;
  reorderMode: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: assessment.assessment_public_id,
    disabled: !reorderMode
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined
  };

  return (
    <tr
      className={`border-b border-line last:border-0 ${isDragging ? "bg-accent-soft" : ""}`}
      key={assessment.assessment_public_id}
      ref={setNodeRef}
      style={style}
    >
      {reorderMode ? (
        <td className="px-4 py-4 align-top">
          <button
            {...attributes}
            {...listeners}
            aria-label={`Move ${assessment.title} mini test`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line bg-white text-muted transition hover:border-accent hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent"
            type="button"
          >
            <GripVertical className="h-5 w-5" aria-hidden="true" />
          </button>
        </td>
      ) : null}
      <td className="px-4 py-4 align-top">
        <p className="font-semibold text-ink">{assessment.title}</p>
        <p className="mt-1 font-mono text-xs text-muted">{assessment.assessment_public_id}</p>
        {reorderMode ? (
          <p className="mt-2 text-xs font-semibold text-accent">Organization changes are not saved yet.</p>
        ) : null}
      </td>
      <td className="px-4 py-4 align-top">
        <StatusBadge status={assessment.status} />
        {isClosed(assessment) ? <p className="mt-1 text-xs font-semibold text-muted">Closed</p> : null}
      </td>
      <td className="px-4 py-4 align-top">
        {assessment.diagnostic_focus ? (
          <p className="line-clamp-2 text-muted">{assessment.diagnostic_focus}</p>
        ) : (
          <p className="text-muted">No diagnostic focus recorded.</p>
        )}
      </td>
      <td className="px-4 py-4 align-top text-muted">{assessment.item_count ?? 0}</td>
      <td className="px-4 py-4 align-top text-muted">{assessment.assessment_session_count ?? 0}</td>
      <td className="px-4 py-4 align-top text-muted">{formatDate(assessment.updated_at)}</td>
      <td className="px-4 py-4 align-top">
        {reorderMode ? (
          <div className="flex min-w-[220px] flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                aria-label={`Move ${assessment.title} up`}
                className="h-9 px-3"
                onClick={() => onMoveUp(assessment.assessment_public_id)}
                type="button"
                variant="secondary"
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
                Up
              </Button>
              <Button
                aria-label={`Move ${assessment.title} down`}
                className="h-9 px-3"
                onClick={() => onMoveDown(assessment.assessment_public_id)}
                type="button"
                variant="secondary"
              >
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
                Down
              </Button>
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
              Move to folder/week/module
              <select
                aria-label={`Move ${assessment.title} to folder/week/module`}
                className="rounded-md border border-line px-3 py-2 text-sm font-normal outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                onChange={(event) => onMoveToFolder(assessment.assessment_public_id, event.target.value)}
                value={folderName(assessment)}
              >
                {folderOptions.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </select>
            </label>
            <Button
              aria-label={`Move ${assessment.title} to Unfiled`}
              className="h-9 justify-start px-3"
              disabled={folderName(assessment) === UNFILED_FOLDER}
              onClick={() => onMoveToFolder(assessment.assessment_public_id, UNFILED_FOLDER)}
              type="button"
              variant="secondary"
            >
              Move to Unfiled
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-ink transition hover:border-accent"
              href={`/teacher/content/assessments/${assessment.assessment_public_id}`}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Open builder
            </Link>
            {assessment.status === "archived" ? (
              <Button
                disabled={isBusy}
                onClick={() => onRestore(assessment)}
                type="button"
                variant="secondary"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Restore
              </Button>
            ) : (
              <Button disabled={isBusy} onClick={() => onArchive(assessment)} type="button" variant="danger">
                <Archive className="h-4 w-4" aria-hidden="true" />
                Archive
              </Button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function AssessmentListClient() {
  const [assessments, setAssessments] = useState<AssessmentSummary[]>([]);
  const [organizationRevision, setOrganizationRevision] = useState<string | null>(null);
  const [error, setError] = useState<StructuredApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isSavingOrganization, setIsSavingOrganization] = useState(false);
  const [draftAssessments, setDraftAssessments] = useState<AssessmentSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [folderFilter, setFolderFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("folder_order");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const loadAssessments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await apiRequest<AssessmentListResponse>("/api/teacher/assessments");
      setAssessments(data.assessments);
      setOrganizationRevision(data.organization_revision);
      if (isReorderMode) {
        setDraftAssessments(data.assessments);
      }
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsLoading(false);
    }
  }, [isReorderMode]);

  useEffect(() => {
    void loadAssessments();
  }, [loadAssessments]);

  const persistedOrganizationSignature = useMemo(
    () => organizationSignature(assessments),
    [assessments]
  );
  const draftOrganizationSignature = useMemo(
    () => organizationSignature(draftAssessments),
    [draftAssessments]
  );
  const hasUnsavedOrganizationChanges =
    isReorderMode && draftOrganizationSignature !== persistedOrganizationSignature;

  useEffect(() => {
    if (!hasUnsavedOrganizationChanges) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedOrganizationChanges]);

  async function archiveAssessment(assessment: AssessmentSummary) {
    setBusyId(assessment.assessment_public_id);
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(`/api/teacher/assessments/${assessment.assessment_public_id}/archive`, {
        method: "POST"
      });
      setSuccess(`Archived ${assessment.title}.`);
      await loadAssessments();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function restoreAssessment(assessment: AssessmentSummary) {
    setBusyId(assessment.assessment_public_id);
    setError(null);
    setSuccess(null);

    try {
      await apiRequest(`/api/teacher/assessments/${assessment.assessment_public_id}/restore`, {
        method: "POST"
      });
      setSuccess(`Restored ${assessment.title}.`);
      await loadAssessments();
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setBusyId(null);
    }
  }

  function startReorderMode() {
    setDraftAssessments(sortAssessments(activeOrganizationAssessments(assessments), "folder_order"));
    setSearchText("");
    setFolderFilter("all");
    setStatusFilter("active");
    setSortMode("folder_order");
    setCollapsedFolders({});
    setSuccess(null);
    setError(null);
    setIsReorderMode(true);
  }

  function cancelReorderMode() {
    setDraftAssessments([]);
    setIsReorderMode(false);
    setError(null);
  }

  function updateDraftGroups(nextGroups: AssessmentGroup[]) {
    setDraftAssessments(normalizeGroups(nextGroups.filter((group) => group.assessments.length > 0)));
  }

  function moveAssessmentToFolderAtIndex(
    assessmentPublicId: string,
    destinationFolder: string,
    destinationIndex: number
  ) {
    const groups = groupAssessmentsByFolder(draftAssessments).map((group) => ({
      ...group,
      assessments: [...group.assessments]
    }));
    let movingAssessment: AssessmentSummary | null = null;

    for (const group of groups) {
      const index = group.assessments.findIndex(
        (assessment) => assessment.assessment_public_id === assessmentPublicId
      );
      if (index >= 0) {
        movingAssessment = group.assessments.splice(index, 1)[0] ?? null;
        break;
      }
    }

    if (!movingAssessment) {
      return;
    }

    let destinationGroup = groups.find((group) => group.folder === destinationFolder);
    if (!destinationGroup) {
      destinationGroup = { folder: destinationFolder, assessments: [] };
      groups.push(destinationGroup);
    }

    const safeIndex = Math.max(0, Math.min(destinationIndex, destinationGroup.assessments.length));
    destinationGroup.assessments.splice(safeIndex, 0, {
      ...movingAssessment,
      folder_label: folderLabelForSave(destinationFolder)
    });

    updateDraftGroups(groups.sort(compareOrganizationFolders));
  }

  function moveAssessmentRelative(assessmentPublicId: string, direction: "up" | "down") {
    const groups = groupAssessmentsByFolder(draftAssessments);
    const group = groups.find((candidate) =>
      candidate.assessments.some((assessment) => assessment.assessment_public_id === assessmentPublicId)
    );

    if (!group) {
      return;
    }

    const currentIndex = group.assessments.findIndex(
      (assessment) => assessment.assessment_public_id === assessmentPublicId
    );
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (nextIndex < 0 || nextIndex >= group.assessments.length) {
      return;
    }

    const nextGroupAssessments = [...group.assessments];
    const [movingAssessment] = nextGroupAssessments.splice(currentIndex, 1);
    if (!movingAssessment) {
      return;
    }
    nextGroupAssessments.splice(nextIndex, 0, movingAssessment);

    updateDraftGroups(
      groups.map((candidate) =>
        candidate.folder === group.folder
          ? { ...candidate, assessments: nextGroupAssessments }
          : candidate
      )
    );
  }

  function moveAssessmentToFolder(assessmentPublicId: string, destinationFolder: string) {
    const destinationGroup = groupAssessmentsByFolder(draftAssessments).find(
      (group) => group.folder === destinationFolder
    );
    moveAssessmentToFolderAtIndex(
      assessmentPublicId,
      destinationFolder,
      destinationGroup?.assessments.length ?? 0
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    if (overId.startsWith("folder:")) {
      const destinationFolder = folderFromDropId(overId);
      const destinationGroup = groupAssessmentsByFolder(draftAssessments).find(
        (group) => group.folder === destinationFolder
      );
      moveAssessmentToFolderAtIndex(activeId, destinationFolder, destinationGroup?.assessments.length ?? 0);
      return;
    }

    const destinationGroup = groupAssessmentsByFolder(draftAssessments).find((group) =>
      group.assessments.some((assessment) => assessment.assessment_public_id === overId)
    );

    if (!destinationGroup) {
      return;
    }

    const overIndex = destinationGroup.assessments.findIndex(
      (assessment) => assessment.assessment_public_id === overId
    );
    moveAssessmentToFolderAtIndex(activeId, destinationGroup.folder, overIndex);
  }

  async function saveOrganization() {
    if (!organizationRevision) {
      setError({
        code: "missing_organization_revision",
        message: "Refresh the assessment library before saving organization changes."
      });
      return;
    }

    setIsSavingOrganization(true);
    setError(null);
    setSuccess(null);

    try {
      const groups = groupAssessmentsByFolder(draftAssessments).map((group) => ({
        folder_label: folderLabelForSave(group.folder),
        assessment_public_ids: group.assessments.map((assessment) => assessment.assessment_public_id)
      }));
      const data = await apiRequest<AssessmentListResponse>("/api/teacher/assessments/organization", {
        method: "POST",
        body: JSON.stringify({
          expected_revision: organizationRevision,
          groups
        })
      });

      setAssessments(data.assessments);
      setOrganizationRevision(data.organization_revision);
      setDraftAssessments([]);
      setIsReorderMode(false);
      setSuccess("Assessment organization saved.");
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsSavingOrganization(false);
    }
  }

  const folderOptions = useMemo(() => {
    return [
      "all",
      ...[...new Set(assessments.map(folderName))]
        .sort((left, right) => {
          if (left === UNFILED_FOLDER) return 1;
          if (right === UNFILED_FOLDER) return -1;
          return left.localeCompare(right);
        })
    ];
  }, [assessments]);

  const reorderFolderOptions = useMemo(() => {
    const folders = [
      ...groupAssessmentsByFolder([...activeOrganizationAssessments(assessments), ...draftAssessments]).map(
        (group) => group.folder
      ),
      UNFILED_FOLDER
    ];
    const uniqueFolders = [...new Set(folders)].filter((folder) => folder !== UNFILED_FOLDER);
    return [...uniqueFolders, UNFILED_FOLDER];
  }, [assessments, draftAssessments]);

  const filteredAssessments = useMemo(() => {
    if (isReorderMode) {
      return sortAssessments(draftAssessments, "folder_order");
    }

    const normalizedSearch = searchText.trim().toLowerCase();
    const filtered = assessments.filter((assessment) => {
      const searchable = [
        assessment.title,
        assessment.assessment_public_id,
        assessment.diagnostic_focus ?? "",
        folderName(assessment)
      ]
        .join(" ")
        .toLowerCase();

      return (
        statusMatches(assessment, statusFilter) &&
        (folderFilter === "all" || folderName(assessment) === folderFilter) &&
        (!normalizedSearch || searchable.includes(normalizedSearch))
      );
    });

    return sortAssessments(filtered, sortMode);
  }, [assessments, draftAssessments, folderFilter, isReorderMode, searchText, sortMode, statusFilter]);

  const groupedAssessments = useMemo(() => {
    const groups = groupAssessmentsByFolder(filteredAssessments);
    if (isReorderMode) {
      return reorderFolderOptions.map((folder) => ({
        folder,
        assessments: groups.find((group) => group.folder === folder)?.assessments ?? []
      }));
    }
    return groups;
  }, [filteredAssessments, isReorderMode, reorderFolderOptions]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assessment library"
        actions={
          isReorderMode ? (
            <>
              <Button
                disabled={isSavingOrganization || !hasUnsavedOrganizationChanges}
                onClick={saveOrganization}
                type="button"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                Save organization
              </Button>
              <Button disabled={isSavingOrganization} onClick={cancelReorderMode} type="button" variant="secondary">
                <X className="h-4 w-4" aria-hidden="true" />
                Cancel
              </Button>
            </>
          ) : (
            <>
              <PrimaryLink href="/teacher/content/assessments/new">
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                New mini test
              </PrimaryLink>
              <Button disabled={isLoading} onClick={startReorderMode} type="button" variant="secondary">
                <GripVertical className="h-4 w-4" aria-hidden="true" />
                Reorder mini tests
              </Button>
              <Button disabled={isLoading} onClick={loadAssessments} type="button" variant="secondary">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Refresh
              </Button>
            </>
          )
        }
      />

      <ErrorPanel error={error} />
      <SuccessPanel message={success} />

      <section className="rounded-lg border border-line bg-white p-4 shadow-soft">
        {isReorderMode ? (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            Search and alternate sorting are unavailable while reordering.
            {hasUnsavedOrganizationChanges ? " You have unsaved organization changes." : ""}
          </p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <Field label="Search">
            <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
              <Search className="h-4 w-4 text-muted" aria-hidden="true" />
              <input
                className="min-w-0 flex-1 outline-none"
                disabled={isReorderMode}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Name, ID, focus, folder"
                value={searchText}
              />
            </div>
          </Field>
          <Field label="Status">
            <select
              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              disabled={isReorderMode}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              value={statusFilter}
            >
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="closed">Closed</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </Field>
          <Field label="Folder">
            <select
              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              disabled={isReorderMode}
              onChange={(event) => setFolderFilter(event.target.value)}
              value={folderFilter}
            >
              {folderOptions.map((folder) => (
                <option key={folder} value={folder}>
                  {folder === "all" ? "All folders" : folder}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sort">
            <select
              className="rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              disabled={isReorderMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              value={sortMode}
            >
              <option value="folder_order">Custom order</option>
              <option value="updated_desc">Recently updated</option>
              <option value="title_asc">Title</option>
              <option value="release_asc">Release date</option>
            </select>
          </Field>
        </div>
      </section>

      {isLoading ? <LoadingRow label="Loading assessments" /> : null}

      {!isLoading && assessments.length === 0 ? (
        <section className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          No assessments have been created yet.
        </section>
      ) : null}

      {!isLoading && assessments.length > 0 && filteredAssessments.length === 0 ? (
        <section className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          No mini tests match the current filters.
        </section>
      ) : null}

      {!isLoading && filteredAssessments.length > 0 ? (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}>
          <div className="space-y-6">
            {groupedAssessments.map((group) => {
              const collapsed = Boolean(collapsedFolders[group.folder]);

              return (
                <DroppableFolderSection folder={group.folder} key={group.folder}>
                  <button
                    className="flex w-full items-center justify-between border-b border-line bg-[#fbfcf8] px-4 py-3 text-left"
                    disabled={isReorderMode}
                    onClick={() =>
                      setCollapsedFolders((previous) => ({
                        ...previous,
                        [group.folder]: !previous[group.folder]
                      }))
                    }
                    type="button"
                  >
                    <span className="flex items-center gap-2">
                      {collapsed ? (
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span className="font-semibold text-ink">{group.folder}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {group.assessments.length} mini test{group.assessments.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  {collapsed ? null : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                        <thead className="border-b border-line bg-[#fbfcf8] text-xs uppercase tracking-wide text-muted">
                          <tr>
                            {isReorderMode ? <th className="px-4 py-3 font-semibold">Move</th> : null}
                            <th className="px-4 py-3 font-semibold">Mini test</th>
                            <th className="px-4 py-3 font-semibold">Status</th>
                            <th className="px-4 py-3 font-semibold">Focus</th>
                            <th className="px-4 py-3 font-semibold">Items</th>
                            <th className="px-4 py-3 font-semibold">Sessions</th>
                            <th className="px-4 py-3 font-semibold">Updated</th>
                            <th className="px-4 py-3 font-semibold">
                              {isReorderMode ? "Organization controls" : "Actions"}
                            </th>
                          </tr>
                        </thead>
                        <SortableContext
                          items={group.assessments.map((assessment) => assessment.assessment_public_id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <tbody>
                            {group.assessments.length === 0 ? (
                              <tr>
                                <td
                                  className="px-4 py-6 text-sm text-muted"
                                  colSpan={isReorderMode ? 8 : 7}
                                >
                                  Drop mini tests here to leave them unfiled.
                                </td>
                              </tr>
                            ) : (
                              group.assessments.map((assessment) => (
                                <SortableAssessmentRow
                                  assessment={assessment}
                                  folderOptions={reorderFolderOptions}
                                  isBusy={busyId === assessment.assessment_public_id}
                                  key={assessment.assessment_public_id}
                                  onArchive={archiveAssessment}
                                  onMoveDown={(assessmentPublicId) =>
                                    moveAssessmentRelative(assessmentPublicId, "down")
                                  }
                                  onMoveToFolder={moveAssessmentToFolder}
                                  onMoveUp={(assessmentPublicId) =>
                                    moveAssessmentRelative(assessmentPublicId, "up")
                                  }
                                  onRestore={restoreAssessment}
                                  reorderMode={isReorderMode}
                                />
                              ))
                            )}
                          </tbody>
                        </SortableContext>
                      </table>
                    </div>
                  )}
                </DroppableFolderSection>
              );
            })}
          </div>
        </DndContext>
      ) : null}
    </div>
  );
}
