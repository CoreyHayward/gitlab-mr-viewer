import { describe, expect, it } from 'vitest';
import { AI_MAX_CHANGE_FILES, boundedAiChanges, buildAiDiffSelectionContext } from '@/review/ai';
import { parseDiff } from '@/review/comments';
import type { ReviewFileChange } from '@/review/types';

const file: ReviewFileChange = {
  path: 'src/example.ts',
  kind: 'modified',
  diff: '@@ -4,3 +4,4 @@\n context\n-removed\n+added\n+another\n tail\n'
};

describe('AI diff selection context', () => {
  it('includes the selected range, its line coordinates, and the full changed file', () => {
    const lines = parseDiff(file.diff).allLines;

    const context = buildAiDiffSelectionContext({
      file,
      start: lines[2],
      end: lines[4]
    });

    expect(context.file).toEqual({
      path: 'src/example.ts',
      oldPath: undefined,
      kind: 'modified',
      diff: file.diff,
      diffTruncated: false
    });
    expect(context.selection.start).toMatchObject({ kind: 'remove', oldLine: 5, newLine: null, text: 'removed' });
    expect(context.selection.end).toMatchObject({ kind: 'add', oldLine: null, newLine: 6, text: 'another' });
    expect(context.selection).toMatchObject({ selectedLineCount: 3, linesTruncated: false });
    expect(context.selection.lines).toEqual([
      { kind: 'remove', oldLine: 5, newLine: null, text: 'removed' },
      { kind: 'add', oldLine: null, newLine: 5, text: 'added' },
      { kind: 'add', oldLine: null, newLine: 6, text: 'another' }
    ]);
  });

  it('keeps a single selected line focused', () => {
    const line = parseDiff(file.diff).allLines[1];

    const context = buildAiDiffSelectionContext({ file, start: line, end: line });

    expect(context.selection.lines).toEqual([
      { kind: 'context', oldLine: 4, newLine: 4, text: 'context' }
    ]);
  });

  it('bounds provider payloads without dropping changed file paths', () => {
    const manyChanges = Array.from({ length: 20 }, (_, index) => ({
      path: `src/${index}.ts`,
      kind: 'modified' as const,
      diff: 'x'.repeat(20_000)
    }));

    const bounded = boundedAiChanges(manyChanges);

    expect(bounded).toHaveLength(manyChanges.length);
    expect(bounded.map((change) => change.path)).toEqual(manyChanges.map((change) => change.path));
    expect(bounded.reduce((total, change) => total + change.diff.length, 0)).toBeLessThanOrEqual(160_000);
    expect(bounded.some((change) => change.diffTruncated)).toBe(true);
  });

  it('caps file metadata in exceptionally large provider requests', () => {
    const manyChanges = Array.from({ length: AI_MAX_CHANGE_FILES + 25 }, (_, index) => ({
      path: `src/${index}.ts`,
      kind: 'modified' as const,
      diff: '+changed'
    }));

    const bounded = boundedAiChanges(manyChanges);

    expect(bounded).toHaveLength(AI_MAX_CHANGE_FILES);
    expect(bounded.at(-1)?.path).toBe(`src/${AI_MAX_CHANGE_FILES - 1}.ts`);
  });

  it('bounds a large selected range while retaining its endpoints and size', () => {
    const largeFile: ReviewFileChange = {
      path: 'src/large.ts',
      kind: 'modified',
      diff: `@@ -1,1000 +1,1000 @@\n${Array.from({ length: 1000 }, (_, index) => ` ${index}-${'x'.repeat(200)}`).join('\n')}`
    };
    const lines = parseDiff(largeFile.diff, Number.POSITIVE_INFINITY).allLines;

    const context = buildAiDiffSelectionContext({
      file: largeFile,
      start: lines[1],
      end: lines.at(-1)!
    });

    expect(context.selection.selectedLineCount).toBe(1000);
    expect(context.selection.linesTruncated).toBe(true);
    expect(context.selection.lines.length).toBeLessThanOrEqual(400);
    expect(context.selection.lines.reduce((total, line) => total + line.text.length, 0)).toBeLessThanOrEqual(40_000);
    expect(context.selection.end.newLine).toBe(1000);
  });
});
