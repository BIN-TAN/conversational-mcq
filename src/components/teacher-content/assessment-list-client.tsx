"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  FolderPlus,
  GripVertical,
  Pencil,
  Trash2,
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { archiveConfirmation, restoreConfirmation } from "@/lib/teacher-management-labels";
import { apiRequest, errorFromUnknown } from "./api";
import { ArchivedAssessmentBatchDeletionControl } from "./archived-assessment-batch-deletion-control";
import type { AssessmentSummary, StructuredApiError } from "./types";
import {
  Button,
  ErrorPanel,
  Field,
  LoadingRow,
  PageHeader,
  PublicIdControl,
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

// Folder positions come from the folder order while organizing (folders, then Unfiled last),
// so a folder keeps its place even when it is empty or moved.
function normalizeGroups(groups: AssessmentGroup[], folderOrder: string[]) {
  const position = (folder: string) => {
    const index = folderOrder.indexOf(folder);
    return folder === UNFILED_FOLDER || index < 0 ? folderOrder.length : index;
  };
  return groups.flatMap((group) =>
    group.assessments.map((assessment, assessmentIndex) => ({
      ...assessment,
      folder_label: folderLabelForSave(group.folder),
      folder_order_index: position(group.folder),
      assessment_order_index: assessmentIndex
    }))
  );
}

const FOLDER_NAME_MAX_LENGTH = 120;

/** Why a folder name cannot be used, or null when it can. */
function folderNameProblem(name: string, existing: string[], current?: string) {
  const trimmed = name.trim();
  if (!trimmed) return "Give the folder a name.";
  if (trimmed.length > FOLDER_NAME_MAX_LENGTH) return `Keep folder names to ${FOLDER_NAME_MAX_LENGTH} characters or fewer.`;
  if (trimmed.toLowerCase() === UNFILED_FOLDER.toLowerCase()) return "Unfiled is kept for mini tests without a folder. Choose another name.";
  const clash = existing.find((folder) => folder !== current && folder.toLowerCase() === trimmed.toLowerCase());
  return clash ? `A folder named ${clash} already exists.` : null;
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
  reorderMode,
  selected,
  onSelect,
  showArchivedSelection
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
  selected: boolean;
  onSelect: (assessmentPublicId: string) => void;
  showArchivedSelection: boolean;
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
      {showArchivedSelection ? (
        <td className="w-12 px-4 py-4 align-top">
          <input
            aria-label={`Select archived mini test ${assessment.title}`}
            checked={selected}
            className="h-4 w-4 rounded border-line accent-emerald-700"
            onChange={() => onSelect(assessment.assessment_public_id)}
            type="checkbox"
          />
        </td>
      ) : null}
      <td className="px-4 py-4 align-top">
        <p className="font-semibold text-ink">{assessment.title}</p>
        {reorderMode ? null : (
          <div className="mt-1">
            <PublicIdControl id={assessment.assessment_public_id} />
          </div>
        )}
        {reorderMode ? (
          <p className="mt-2 text-xs font-semibold text-accent">Organization changes are not saved yet.</p>
        ) : null}
      </td>
      <td className="px-4 py-4 align-top">
        <StatusBadge assessment={assessment} status={assessment.status} />
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
              Open assessment
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
  const [pendingAction, setPendingAction] = useState<{
    kind: "archive" | "restore";
    assessment: AssessmentSummary;
  } | null>(null);
  // Read by loadAssessments without making it depend on the mode, so entering, cancelling or
  // saving reorder mode never triggers a reload that replaces the active-only draft.
  const isReorderModeRef = useRef(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [folderFilter, setFolderFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("folder_order");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [selectedArchivedIds, setSelectedArchivedIds] = useState<Set<string>>(new Set());
  // Folders while organizing: their order (Unfiled excluded, always last), the saved name each
  // current folder started from (renames), and the saved folders deleted in this session.
  const [folderOrder, setFolderOrder] = useState<string[]>([]);
  const [folderOrigins, setFolderOrigins] = useState<Record<string, string>>({});
  const [deletedFolderOrigins, setDeletedFolderOrigins] = useState<string[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  useEffect(() => {
    isReorderModeRef.current = isReorderMode;
  }, [isReorderMode]);

  const loadAssessments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await apiRequest<AssessmentListResponse>("/api/teacher/assessments");
      setAssessments(data.assessments);
      setOrganizationRevision(data.organization_revision);
      if (isReorderModeRef.current) {
        setDraftAssessments(
          sortAssessments(activeOrganizationAssessments(data.assessments), "folder_order")
        );
      }
    } catch (caught) {
      setError(errorFromUnknown(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssessments();
  }, [loadAssessments]);

  useEffect(() => {
    setSelectedArchivedIds(new Set());
  }, [folderFilter, searchText, sortMode, statusFilter]);

  // The draft holds active mini tests only, so it is compared with the active ones.
  const persistedOrganizationSignature = useMemo(
    () => organizationSignature(activeOrganizationAssessments(assessments)),
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

  async function confirmPendingAction() {
    if (!pendingAction) {
      return;
    }

    const { kind, assessment } = pendingAction;
    if (kind === "archive") {
      await archiveAssessment(assessment);
    } else {
      await restoreAssessment(assessment);
    }
    setPendingAction(null);
  }

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

  function resetFolderEditing(folders: string[]) {
    setFolderOrder(folders);
    setFolderOrigins(Object.fromEntries(folders.map((folder) => [folder, folder])));
    setDeletedFolderOrigins([]);
    setNewFolderName("");
    setRenamingFolder(null);
    setRenameDraft("");
    setFolderError(null);
  }

  function startReorderMode() {
    const active = sortAssessments(activeOrganizationAssessments(assessments), "folder_order");
    resetFolderEditing(
      groupAssessmentsByFolder(active)
        .map((group) => group.folder)
        .filter((folder) => folder !== UNFILED_FOLDER)
    );
    setDraftAssessments(active);
    setSearchText("");
    setFolderFilter("all");
    setStatusFilter("active");
    setSortMode("folder_order");
    setCollapsedFolders({});
    setSuccess(null);
    setError(null);
    setSelectedArchivedIds(new Set());
    setIsReorderMode(true);
  }

  function cancelReorderMode() {
    setDraftAssessments([]);
    resetFolderEditing([]);
    setIsReorderMode(false);
    setError(null);
  }

  function updateDraftGroups(nextGroups: AssessmentGroup[], order: string[] = folderOrder) {
    setDraftAssessments(normalizeGroups(nextGroups.filter((group) => group.assessments.length > 0), order));
  }

  function addFolder() {
    const problem = folderNameProblem(newFolderName, folderOrder);
    if (problem) {
      setFolderError(problem);
      return;
    }
    setFolderOrder([...folderOrder, newFolderName.trim()]);
    setNewFolderName("");
    setFolderError(null);
  }

  function startRenamingFolder(folder: string) {
    setRenamingFolder(folder);
    setRenameDraft(folder);
    setFolderError(null);
  }

  function renameFolder(folder: string) {
    const nextName = renameDraft.trim();
    const problem = folderNameProblem(nextName, folderOrder, folder);
    if (problem) {
      setFolderError(problem);
      return;
    }
    const nextOrder = folderOrder.map((entry) => (entry === folder ? nextName : entry));
    const groups = groupAssessmentsByFolder(draftAssessments).map((group) =>
      group.folder === folder ? { ...group, folder: nextName } : group
    );
    setFolderOrigins((current) => {
      const next = { ...current };
      const origin = next[folder];
      delete next[folder];
      if (origin) next[nextName] = origin;
      return next;
    });
    setFolderOrder(nextOrder);
    updateDraftGroups(groups, nextOrder);
    setRenamingFolder(null);
    setRenameDraft("");
    setFolderError(null);
  }

  // Deleting a folder never deletes mini tests: they move to Unfiled.
  function deleteFolder(folder: string) {
    const nextOrder = folderOrder.filter((entry) => entry !== folder);
    const groups = groupAssessmentsByFolder(draftAssessments);
    const moving = groups.find((group) => group.folder === folder)?.assessments ?? [];
    const unfiled = groups.find((group) => group.folder === UNFILED_FOLDER)?.assessments ?? [];
    const nextGroups = [
      ...groups.filter((group) => group.folder !== folder && group.folder !== UNFILED_FOLDER),
      { folder: UNFILED_FOLDER, assessments: [...unfiled, ...moving] }
    ];
    const origin = folderOrigins[folder];
    if (origin) setDeletedFolderOrigins((current) => [...current, origin]);
    setFolderOrigins((current) => {
      const next = { ...current };
      delete next[folder];
      return next;
    });
    setFolderOrder(nextOrder);
    updateDraftGroups(nextGroups, nextOrder);
    if (renamingFolder === folder) setRenamingFolder(null);
    setFolderError(null);
  }

  function moveFolder(folder: string, direction: "up" | "down") {
    const index = folderOrder.indexOf(folder);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= folderOrder.length) return;
    const nextOrder = [...folderOrder];
    [nextOrder[index], nextOrder[target]] = [nextOrder[target], nextOrder[index]];
    setFolderOrder(nextOrder);
    updateDraftGroups(groupAssessmentsByFolder(draftAssessments), nextOrder);
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

    updateDraftGroups(groups);
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
      const folderRenames = [
        ...Object.entries(folderOrigins)
          .filter(([folder, origin]) => folder !== origin)
          .map(([folder, origin]) => ({ from: origin, to: folder })),
        ...deletedFolderOrigins.map((origin) => ({ from: origin, to: null }))
      ];
      const emptyFolders = folderOrder.filter(
        (folder) => !groups.some((group) => group.folder_label === folder)
      );
      const data = await apiRequest<AssessmentListResponse>("/api/teacher/assessments/organization", {
        method: "POST",
        body: JSON.stringify({
          expected_revision: organizationRevision,
          groups,
          folder_renames: folderRenames
        })
      });

      setAssessments(data.assessments);
      setOrganizationRevision(data.organization_revision);
      setDraftAssessments([]);
      resetFolderEditing([]);
      setIsReorderMode(false);
      setSuccess(
        emptyFolders.length > 0
          ? `Assessment organization saved. A folder is kept only while it holds a mini test, so ${emptyFolders.length === 1 ? "this empty folder was" : "these empty folders were"} not saved: ${emptyFolders.join(", ")}.`
          : "Assessment organization saved."
      );
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

  const reorderFolderOptions = useMemo(() => [...folderOrder, UNFILED_FOLDER], [folderOrder]);

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

  const showArchivedSelection = !isReorderMode && statusFilter === "archived";
  const visibleArchivedIds = useMemo(
    () =>
      filteredAssessments
        .filter((assessment) => assessment.status === "archived")
        .map((assessment) => assessment.assessment_public_id),
    [filteredAssessments]
  );
  const allVisibleArchivedSelected =
    visibleArchivedIds.length > 0 &&
    visibleArchivedIds.every((assessmentPublicId) =>
      selectedArchivedIds.has(assessmentPublicId)
    );

  function toggleArchivedAssessment(assessmentPublicId: string) {
    setSelectedArchivedIds((current) => {
      const next = new Set(current);
      if (next.has(assessmentPublicId)) next.delete(assessmentPublicId);
      else next.add(assessmentPublicId);
      return next;
    });
  }

  function toggleAllVisibleArchivedAssessments() {
    setSelectedArchivedIds((current) => {
      const next = new Set(current);
      if (allVisibleArchivedSelected) {
        for (const assessmentPublicId of visibleArchivedIds) next.delete(assessmentPublicId);
      } else {
        for (const assessmentPublicId of visibleArchivedIds) next.add(assessmentPublicId);
      }
      return next;
    });
  }

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
              <Button disabled={isLoading} onClick={startReorderMode} type="button" variant="secondary">
                <GripVertical className="h-4 w-4" aria-hidden="true" />
                Organize folders and mini tests
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
          <>
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              Search and alternate sorting are unavailable while reordering.
              {hasUnsavedOrganizationChanges ? " You have unsaved organization changes." : ""}
            </p>
            <div className="mb-4 flex flex-wrap items-end gap-2" data-testid="add-folder">
              <Field label="New folder">
                <input
                  className="w-72 max-w-full rounded-md border border-line px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  maxLength={FOLDER_NAME_MAX_LENGTH}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addFolder();
                    }
                  }}
                  placeholder="e.g. Week 5"
                  value={newFolderName}
                />
              </Field>
              <Button onClick={addFolder} type="button" variant="secondary">
                <FolderPlus className="h-4 w-4" aria-hidden="true" />
                Add folder
              </Button>
            </div>
            <p className="mb-4 text-xs text-muted">
              Rename, move or delete a folder with the buttons on its header. Deleting a folder moves its mini tests to
              Unfiled; no mini test is deleted. A new folder is kept once it holds a mini test. Nothing changes until
              you choose Save organization.
            </p>
            {folderError ? (
              <p className="mb-4 text-sm text-red-800" role="alert">
                {folderError}
              </p>
            ) : null}
          </>
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

      {showArchivedSelection && !isLoading ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white px-4 py-3 shadow-soft">
          <label className="flex items-center gap-3 text-sm font-semibold text-ink">
            <input
              aria-label="Select all matching archived mini tests"
              checked={allVisibleArchivedSelected}
              className="h-4 w-4 rounded border-line accent-emerald-700"
              disabled={visibleArchivedIds.length === 0}
              onChange={toggleAllVisibleArchivedAssessments}
              type="checkbox"
            />
            {selectedArchivedIds.size} selected
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {selectedArchivedIds.size > 0 ? (
              <Button
                onClick={() => setSelectedArchivedIds(new Set())}
                type="button"
                variant="secondary"
              >
                Clear selection
              </Button>
            ) : null}
            <ArchivedAssessmentBatchDeletionControl
              assessmentPublicIds={[...selectedArchivedIds].sort()}
              onDeleted={(summary) => {
                setSelectedArchivedIds(new Set());
                setSuccess(
                  `${summary.deleted_counts.assessment_count} archived mini ${summary.deleted_counts.assessment_count === 1 ? "test" : "tests"} deleted.`
                );
                void loadAssessments();
              }}
            />
          </div>
        </section>
      ) : null}

      {isLoading ? <LoadingRow label="Loading assessments" /> : null}

      {!isLoading && assessments.length === 0 ? (
        <section className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          No assessments have been created yet.
        </section>
      ) : null}

      {!isLoading && assessments.length > 0 && filteredAssessments.length === 0 ? (
        <section className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          <p>No mini tests match the current filters.</p>
          {statusFilter === "active" && assessments.some((assessment) => assessment.status === "archived") ? (
            <button
              className="mt-3 font-semibold text-emerald-800 underline underline-offset-4"
              onClick={() => setStatusFilter("archived")}
              type="button"
            >
              View archived mini tests
            </button>
          ) : null}
        </section>
      ) : null}

      {!isLoading && filteredAssessments.length > 0 ? (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}>
          <div className="space-y-6">
            {groupedAssessments.map((group) => {
              const collapsed = Boolean(collapsedFolders[group.folder]);

              return (
                <DroppableFolderSection folder={group.folder} key={group.folder}>
                  {isReorderMode && group.folder !== UNFILED_FOLDER ? (
                    <div
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#fbfcf8] px-4 py-3"
                      data-testid={`folder-controls-${group.folder}`}
                    >
                      {renamingFolder === group.folder ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <input
                            aria-label={`New name for ${group.folder}`}
                            autoFocus
                            className="w-64 max-w-full rounded-md border border-line px-3 py-1.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                            maxLength={FOLDER_NAME_MAX_LENGTH}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                renameFolder(group.folder);
                              }
                              if (event.key === "Escape") setRenamingFolder(null);
                            }}
                            value={renameDraft}
                          />
                          <Button className="h-9 px-3" onClick={() => renameFolder(group.folder)} type="button">
                            Save name
                          </Button>
                          <Button className="h-9 px-3" onClick={() => setRenamingFolder(null)} type="button" variant="secondary">
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="font-semibold text-ink">{group.folder}</span>
                      )}
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted">
                          {group.assessments.length} mini test{group.assessments.length === 1 ? "" : "s"}
                        </span>
                        <Button
                          aria-label={`Move folder ${group.folder} up`}
                          className="h-9 px-3"
                          disabled={folderOrder.indexOf(group.folder) <= 0}
                          onClick={() => moveFolder(group.folder, "up")}
                          type="button"
                          variant="secondary"
                        >
                          <ArrowUp className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          aria-label={`Move folder ${group.folder} down`}
                          className="h-9 px-3"
                          disabled={folderOrder.indexOf(group.folder) >= folderOrder.length - 1}
                          onClick={() => moveFolder(group.folder, "down")}
                          type="button"
                          variant="secondary"
                        >
                          <ArrowDown className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          aria-label={`Rename folder ${group.folder}`}
                          className="h-9 px-3"
                          onClick={() => startRenamingFolder(group.folder)}
                          type="button"
                          variant="secondary"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                          Rename
                        </Button>
                        <Button
                          aria-label={`Delete folder ${group.folder}`}
                          className="h-9 px-3"
                          onClick={() => deleteFolder(group.folder)}
                          type="button"
                          variant="danger"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Delete folder
                        </Button>
                      </span>
                    </div>
                  ) : (
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
                  )}
                  {collapsed ? null : (
                    <div
                      aria-label={`${group.folder} mini tests`}
                      className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      role="region"
                      tabIndex={0}
                    >
                      <p className="border-b border-line px-4 py-2 text-xs text-muted lg:hidden">
                        Scroll sideways to see every column.
                      </p>
                      <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                        <thead className="border-b border-line bg-[#fbfcf8] text-xs uppercase tracking-wide text-muted">
                          <tr>
                            {isReorderMode ? <th className="px-4 py-3 font-semibold">Move</th> : null}
                            {showArchivedSelection ? (
                              <th className="w-12 px-4 py-3 font-semibold">Select</th>
                            ) : null}
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
                                  {group.folder === UNFILED_FOLDER
                                    ? "Drop mini tests here to leave them unfiled."
                                    : "This folder is empty. Drag mini tests here, or use Move to folder/week/module."}
                                </td>
                              </tr>
                            ) : (
                              group.assessments.map((assessment) => (
                                <SortableAssessmentRow
                                  assessment={assessment}
                                  folderOptions={reorderFolderOptions}
                                  isBusy={busyId === assessment.assessment_public_id}
                                  key={assessment.assessment_public_id}
                                  onArchive={(target) => setPendingAction({ kind: "archive", assessment: target })}
                                  onMoveDown={(assessmentPublicId) =>
                                    moveAssessmentRelative(assessmentPublicId, "down")
                                  }
                                  onMoveToFolder={moveAssessmentToFolder}
                                  onMoveUp={(assessmentPublicId) =>
                                    moveAssessmentRelative(assessmentPublicId, "up")
                                  }
                                  onRestore={(target) => setPendingAction({ kind: "restore", assessment: target })}
                                  onSelect={toggleArchivedAssessment}
                                  reorderMode={isReorderMode}
                                  selected={selectedArchivedIds.has(assessment.assessment_public_id)}
                                  showArchivedSelection={showArchivedSelection}
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

      {pendingAction ? (() => {
        const copy = pendingAction.kind === "archive"
          ? archiveConfirmation(pendingAction.assessment)
          : restoreConfirmation(pendingAction.assessment);
        return (
          <ConfirmDialog
            busy={busyId === pendingAction.assessment.assessment_public_id}
            confirmLabel={copy.confirmLabel}
            id={`assessment-${pendingAction.kind}-dialog`}
            onCancel={() => setPendingAction(null)}
            onConfirm={() => void confirmPendingAction()}
            question={copy.question}
            tone={pendingAction.kind === "archive" ? "danger" : "primary"}
          >
            {copy.sentences.map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </ConfirmDialog>
        );
      })() : null}
    </div>
  );
}
