import { describe, expect, it, vi } from 'vitest';
import { buildReviewDelta, reconcileSavedReviewState } from '@/review/delta';
import type { GitLabService } from '@/services/gitlab';
import type { GitLabMergeRequest } from '@/types/gitlab';
import type { SemanticSection } from '@/review/types';

describe('guided review deltas', () => {
  it('keeps every changed path so concepts after the first 24 are marked stale', async () => {
    const paths = Array.from({ length: 30 }, (_, index) => `src/file-${index}.ts`);
    const service = {
      compareMergeRequestCommits: vi.fn().mockResolvedValue({
        diffs: paths.map((path) => ({ old_path: path, new_path: path }))
      })
    } as unknown as GitLabService;
    const mergeRequest = { project_id: 7 } as GitLabMergeRequest;

    const delta = await buildReviewDelta(service, mergeRequest, 'a'.repeat(40), 'b'.repeat(40));
    const sections = paths.map((path, index) => ({
      id: `section-${index}`,
      title: path,
      intent: '',
      reviewFocus: '',
      risk: 'medium',
      filePaths: [path],
      files: [],
      relatedSectionIds: [],
      prompts: []
    })) as SemanticSection[];
    const saved = {
      statuses: Object.fromEntries(sections.map((section) => [section.id, 'reviewed' as const])),
      notes: {}
    };

    const reconciled = reconcileSavedReviewState(sections, saved, delta);

    expect(delta.changedPaths).toHaveLength(30);
    expect(reconciled.statuses['section-29']).toBe('stale');
  });
});
