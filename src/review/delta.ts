import type { GitLabMergeRequest } from '@/types/gitlab';
import type { ReviewDelta, SavedReviewState, SemanticSection } from '@/review/types';
import type { GitLabService } from '@/services/gitlab';

export const APPROVAL_STEP_ID = '__guided-review-approval__';

export async function buildReviewDelta(
  service: GitLabService,
  mergeRequest: GitLabMergeRequest,
  previousHeadSha: string | undefined,
  currentHeadSha: string,
  signal?: AbortSignal
): Promise<ReviewDelta> {
  if (!previousHeadSha) {
    return { state: 'first-review', summary: ['This is the first saved review for this merge request.'], changedPaths: [], newPaths: [] };
  }
  if (previousHeadSha === currentHeadSha) {
    return { state: 'unchanged', summary: ['No new commit has landed since this review was last saved.'], changedPaths: [], newPaths: [] };
  }
  if (!/^[a-f0-9]{7,80}$/i.test(previousHeadSha) || !/^[a-f0-9]{7,80}$/i.test(currentHeadSha)) {
    return {
      state: 'updated',
      summary: ['The merge request has a new head commit since you last saved this review.', 'Previously reviewed concepts are marked stale conservatively.'],
      changedPaths: [],
      newPaths: []
    };
  }

  try {
    const comparison = await service.compareMergeRequestCommits(mergeRequest.project_id, previousHeadSha, currentHeadSha, signal);
    const diffs = comparison.diffs ?? [];
    const changedPaths = Array.from(new Set(diffs
      .map((diff) => String(diff.new_path ?? diff.old_path ?? '').trim())
      .filter(Boolean)));
    const newPaths = Array.from(new Set(diffs
      .filter((diff) => diff.new_file)
      .map((diff) => String(diff.new_path ?? '').trim())
      .filter(Boolean)));
    return {
      state: 'updated',
      summary: [
        `${changedPaths.length || diffs.length} ${changedPaths.length === 1 ? 'file changed' : 'files changed'} since you last saved this review.`,
        ...(newPaths.length ? [`${newPaths.length} ${newPaths.length === 1 ? 'new file was' : 'new files were'} introduced.`] : []),
        'Previously reviewed concepts touching those files are marked stale.'
      ],
      changedPaths,
      newPaths
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      state: 'updated',
      summary: ['The merge request has a new head commit since you last saved this review.', 'The file-by-file delta was unavailable, so reviewed concepts are marked stale conservatively.'],
      changedPaths: [],
      newPaths: []
    };
  }
}

export function reconcileSavedReviewState(
  sections: SemanticSection[],
  saved: SavedReviewState | undefined,
  delta: ReviewDelta
): SavedReviewState {
  const sectionIds = new Set(sections.map((section) => section.id));
  const statuses: SavedReviewState['statuses'] = {};
  const notes: SavedReviewState['notes'] = {};
  for (const [id, status] of Object.entries(saved?.statuses ?? {})) {
    if (sectionIds.has(id)) statuses[id] = status;
  }
  for (const [id, note] of Object.entries(saved?.notes ?? {})) {
    if (sectionIds.has(id) && typeof note === 'string') notes[id] = note;
  }

  if (delta.state === 'updated') {
    const changed = new Set(delta.changedPaths);
    for (const section of sections) {
      const touched = changed.size === 0 || section.filePaths.some((path) => changed.has(path));
      if (touched && (statuses[section.id] === 'reviewed' || statuses[section.id] === 'in-progress')) {
        statuses[section.id] = 'stale';
      }
    }
  }

  const selectedSectionId = saved?.selectedSectionId === APPROVAL_STEP_ID
    ? APPROVAL_STEP_ID
    : saved?.selectedSectionId && sectionIds.has(saved.selectedSectionId)
      ? saved.selectedSectionId
      : sections[0]?.id;
  return { statuses, notes, selectedSectionId };
}
