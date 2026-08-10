import { describe, expect, it } from 'vitest';
import { createHeuristicReview, normaliseAiReview } from '@/review/organizeReview';
import type { AiReviewOutline, ReviewFileChange } from '@/review/types';

const changes: ReviewFileChange[] = [
  { path: 'src/a.ts', kind: 'modified', diff: '@@ -1 +1 @@\n-old\n+new' },
  { path: 'src/b.ts', kind: 'added', diff: '@@ -0,0 +1 @@\n+new' },
  { path: 'src/c.ts', kind: 'added', diff: '@@ -0,0 +1 @@\n+new' }
];

describe('AI review normalization', () => {
  it('assigns each file once and keeps section IDs unique after fallbacks', () => {
    const fallback = createHeuristicReview('Change', changes);
    const outline = {
      overview: fallback.overview,
      sections: [
        { id: 'duplicate', title: 'First', filePaths: ['src/a.ts', 'src/b.ts'] },
        { id: 'duplicate', title: 'Second', filePaths: ['src/a.ts', 'src/c.ts'] },
        { id: 'remaining-changes', title: 'Reserved', filePaths: ['src/b.ts'] }
      ]
    } as AiReviewOutline;

    const review = normaliseAiReview(outline, fallback, changes);
    const ids = review.sections.map((section) => section.id);
    const paths = review.sections.flatMap((section) => section.filePaths);

    expect(new Set(ids).size).toBe(ids.length);
    expect(paths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('ignores malformed sections in untrusted AI output', () => {
    const fallback = createHeuristicReview('Change', changes);
    const outline = {
      overview: null,
      sections: [null, 'invalid', { id: 'valid', title: 'Valid', filePaths: ['src/a.ts'] }]
    } as unknown as AiReviewOutline;

    const review = normaliseAiReview(outline, fallback, changes);

    expect(review.sections[0].id).toBe('valid');
    expect(review.sections.flatMap((section) => section.filePaths)).toEqual(changes.map((change) => change.path));
    expect(review.overview).toEqual(fallback.overview);
  });
});
