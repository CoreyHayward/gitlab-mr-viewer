import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  legacySemanticReviewCacheKey,
  readAiProviderConfig,
  readSemanticReviewCache,
  reviewInputSignature,
  semanticReviewCacheKey,
  writeAiProviderConfig,
  writeSemanticReviewCache
} from '@/review/storage';
import type { CachedSemanticReview } from '@/review/types';

const cachedReview: CachedSemanticReview = {
  updatedAt: 123,
  state: { statuses: {}, notes: {} },
  workspace: {
    mergeRequest: {
      projectId: 7,
      projectPath: 'group/viewer',
      iid: 12,
      title: 'Review',
      author: 'Author',
      sourceBranch: 'feature',
      targetBranch: 'main',
      headSha: 'a'.repeat(40),
      changedFiles: 1
    },
    review: {
      overview: { purpose: 'Review', scope: 'One file', riskSummary: 'Low', areas: ['Code'] },
      sections: []
    },
    delta: { state: 'first-review', summary: [], changedPaths: [], newPaths: [] },
    ai: { configured: false, used: false },
    truncated: false
  }
};

const localStorageStub = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
};

describe('guided review storage scoping', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses both instance and current user in cache keys', () => {
    expect(semanticReviewCacheKey('https://one.example', 1, 7, 12)).not.toBe(
      semanticReviewCacheKey('https://one.example', 2, 7, 12)
    );
    expect(semanticReviewCacheKey('https://one.example', 1, 7, 12)).not.toBe(
      semanticReviewCacheKey('https://two.example', 1, 7, 12)
    );
  });

  it('invalidates cached review inputs when diff refs or changed code changes', () => {
    const input = {
      title: 'Review',
      description: 'Description',
      sourceBranch: 'feature',
      targetBranch: 'main',
      baseSha: 'base-one',
      startSha: 'start-one',
      headSha: 'head-one',
      changes: [{ path: 'src/example.ts', kind: 'modified' as const, diff: '-old\n+new' }]
    };

    expect(reviewInputSignature(input)).not.toBe(reviewInputSignature({ ...input, baseSha: 'base-two' }));
    expect(reviewInputSignature(input)).not.toBe(reviewInputSignature({
      ...input,
      changes: [{ ...input.changes[0], diff: '-old\n+different' }]
    }));
  });

  it('migrates a valid legacy cache into split user-scoped storage', () => {
    const localStorage = localStorageStub();
    vi.stubGlobal('window', { localStorage });
    const legacyKey = legacySemanticReviewCacheKey('https://gitlab.example.com', 7, 12);
    const key = semanticReviewCacheKey('https://gitlab.example.com', 99, 7, 12);
    localStorage.setItem(legacyKey, JSON.stringify(cachedReview));

    const result = readSemanticReviewCache(key, legacyKey);

    expect(result).toEqual(cachedReview);
    expect(localStorage.getItem(`${key}:workspace`)).not.toBeNull();
    expect(localStorage.getItem(`${key}:state`)).not.toBeNull();
    expect(localStorage.getItem(legacyKey)).toBeNull();
  });

  it('does not replace saved state when a changed workspace exceeds the storage ceiling', () => {
    const localStorage = localStorageStub();
    vi.stubGlobal('window', { localStorage });
    const key = semanticReviewCacheKey('https://gitlab.example.com', 99, 7, 12);
    const originalState = { statuses: {}, notes: { review: 'keep this' } };
    expect(writeSemanticReviewCache(key, cachedReview.workspace, originalState)).toBe(true);

    const oversizedWorkspace = structuredClone(cachedReview.workspace);
    oversizedWorkspace.review.sections = [{
      id: 'large-change',
      title: 'Large change',
      intent: 'Review it',
      reviewFocus: 'Correctness',
      risk: 'medium',
      filePaths: ['large.ts'],
      files: [{ path: 'large.ts', kind: 'modified', diff: 'x'.repeat(4_100_000) }],
      relatedSectionIds: [],
      prompts: []
    }];

    expect(writeSemanticReviewCache(key, oversizedWorkspace, { statuses: {}, notes: { review: 'new' } })).toBe(false);
    expect(JSON.parse(localStorage.getItem(`${key}:state`) ?? '{}').state).toEqual(originalState);
  });

  it('ignores malformed nested cache data instead of exposing it to the review UI', () => {
    const localStorage = localStorageStub();
    vi.stubGlobal('window', { localStorage });
    const key = semanticReviewCacheKey('https://gitlab.example.com', 99, 7, 12);
    const malformed = structuredClone(cachedReview.workspace) as unknown as Record<string, unknown>;
    malformed.review = { ...cachedReview.workspace.review, sections: [null] };
    localStorage.setItem(`${key}:workspace`, JSON.stringify(malformed));
    localStorage.setItem(`${key}:state`, JSON.stringify({ state: cachedReview.state, updatedAt: 123 }));

    expect(readSemanticReviewCache(key)).toBeNull();
  });

  it('validates stored AI endpoints through the same connection rules as the form', () => {
    const localStorage = localStorageStub();
    vi.stubGlobal('window', { localStorage });
    localStorage.setItem('gitlab-mr-viewer:ai-config:v1', JSON.stringify({
      apiKey: 'key',
      model: 'model',
      apiBaseUrl: 'ftp://ai.example.com'
    }));

    expect(readAiProviderConfig()).toBeNull();
    expect(writeAiProviderConfig({ apiKey: 'key', model: 'model', apiBaseUrl: 'http://ai.example.com' })).toBe(false);
  });
});
