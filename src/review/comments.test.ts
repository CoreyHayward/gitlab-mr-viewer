import { describe, expect, it } from 'vitest';
import {
  createDiscussionPosition,
  normalizeDiscussions,
  parseDiff,
  threadLocationLabel
} from '@/review/comments';
import type { GitLabMergeRequestDiscussion } from '@/types/gitlab';
import type { ReviewFileChange } from '@/review/types';

const file: ReviewFileChange = {
  path: 'src/example.ts',
  kind: 'modified',
  diff: '@@ -4,3 +4,4 @@\n context\n-removed\n+added\n+another\n tail\n'
};

const note = (id: number, body: string, position?: GitLabMergeRequestDiscussion['notes'][number]['position']) => ({
  id,
  type: 'DiffNote' as const,
  body,
  author: null,
  created_at: '2026-08-07T10:00:00Z',
  position
});

describe('diff comments', () => {
  it('keeps old and new coordinates while parsing a hunk', () => {
    const parsed = parseDiff(file.diff);

    expect(parsed.additions).toBe(2);
    expect(parsed.deletions).toBe(1);
    expect(parsed.lines.map((line) => [line.kind, line.oldLine, line.newLine])).toEqual([
      ['meta', null, null],
      ['context', 4, 4],
      ['remove', 5, null],
      ['add', null, 5],
      ['add', null, 6],
      ['context', 6, 7]
    ]);
  });

  it('builds single-line positions for added, removed, and context lines', async () => {
    const lines = parseDiff(file.diff).allLines;
    const refs = { baseSha: 'base123', startSha: 'start123', headSha: 'head123' };

    await expect(createDiscussionPosition(refs, file, { start: lines[2], end: lines[2] })).resolves.toMatchObject({
      old_path: 'src/example.ts',
      new_path: 'src/example.ts',
      old_line: 5
    });
    await expect(createDiscussionPosition(refs, file, { start: lines[3], end: lines[3] })).resolves.toMatchObject({ new_line: 5 });
    await expect(createDiscussionPosition(refs, file, { start: lines[1], end: lines[1] })).resolves.toMatchObject({ old_line: 4, new_line: 4 });
  });

  it('builds a GitLab line range with line codes for multiline comments', async () => {
    const lines = parseDiff(file.diff).allLines;
    const position = await createDiscussionPosition(
      { baseSha: 'base123', startSha: 'start123', headSha: 'head123' },
      file,
      { start: lines[1], end: lines[4] }
    );

    expect(position.line_range?.start).toMatchObject({ type: 'new', old_line: 4, new_line: 4 });
    expect(position.line_range?.end).toMatchObject({ type: 'new', new_line: 6 });
    expect(position.line_range?.start?.line_code).toMatch(/^[a-f0-9]{40}_4_4$/);
    expect(position.line_range?.end?.line_code).toMatch(/^[a-f0-9]{40}_0_6$/);
  });

  it('keeps replies with an inline thread and marks old or missing anchors stale', () => {
    const lines = parseDiff(file.diff).allLines;
    const discussions: GitLabMergeRequestDiscussion[] = [
      {
        id: 'current-thread',
        individual_note: false,
        notes: [
          note(1, 'Please validate this branch.', { head_sha: 'head123', new_path: file.path, old_path: file.path, position_type: 'text', new_line: 5 }),
          note(2, 'Good catch, I will add a test.')
        ]
      },
      {
        id: 'stale-thread',
        individual_note: false,
        notes: [note(3, 'This was on the previous revision.', { head_sha: 'oldhead', new_path: file.path, old_path: file.path, position_type: 'text', new_line: 5 })]
      },
      {
        id: 'missing-line',
        individual_note: false,
        notes: [note(4, 'The old line disappeared.', { head_sha: 'head123', new_path: file.path, old_path: file.path, position_type: 'text', new_line: 99 })]
      },
      {
        id: 'general',
        individual_note: true,
        notes: [note(5, 'General question')]
      }
    ];

    const threads = normalizeDiscussions(discussions, 'head123', [{ file, lines }]);
    expect(threads[0]).toMatchObject({ inline: true, stale: false, resolved: false });
    expect(threads[0].discussion.notes).toHaveLength(2);
    expect(threads[1]).toMatchObject({ inline: true, stale: true, staleReason: 'commit' });
    expect(threads[2]).toMatchObject({ inline: false, stale: true, staleReason: 'line' });
    expect(threads[3]).toMatchObject({ inline: false, stale: false });
    expect(threadLocationLabel({ start: { type: 'new', line: 5 }, end: { type: 'new', line: 6 } })).toBe('Lines 5–6');
  });
});
