import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopReview, ReviewRef } from '../../desktop/contracts';
import {
  desktopReviewStorageKey,
  readDesktopReview,
  readRecentDesktopReviews,
  touchRecentDesktopReview,
  writeDesktopReview
} from '@/desktop/storage';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const githubRef: ReviewRef = {
  sourceControl: 'github',
  host: 'GitHub.com',
  owner: 'ReviewFlow',
  repository: 'Desktop',
  number: 27
};

const githubReview: DesktopReview = {
  ref: githubRef,
  id: 'github:ReviewFlow/Desktop:27',
  number: 27,
  numberLabel: '#27',
  repository: {
    sourceControl: 'github',
    remoteId: 'R_27',
    name: 'Desktop',
    pathWithNamespace: 'ReviewFlow/Desktop',
    webUrl: 'https://github.com/ReviewFlow/Desktop'
  },
  title: 'Add a GitHub adapter',
  description: '',
  webUrl: 'https://github.com/ReviewFlow/Desktop/pull/27',
  author: { id: 1, name: 'Contributor', username: 'contributor' },
  reviewers: [],
  assignees: [],
  sourceBranch: 'github-adapter',
  targetBranch: 'main',
  headSha: 'a'.repeat(40),
  draft: false,
  readiness: 'ready',
  readinessLabel: 'Ready for review',
  labels: [],
  createdAt: '2026-08-10T10:00:00Z',
  updatedAt: '2026-08-11T10:00:00Z'
};

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: new MemoryStorage() });
});

describe('desktop review persistence', () => {
  it('uses a stable provider-specific key and filters corrupt saved status entries', () => {
    expect(desktopReviewStorageKey(githubRef)).toBe(desktopReviewStorageKey({
      ...githubRef,
      host: 'github.com',
      owner: 'reviewflow',
      repository: 'desktop'
    }));

    expect(writeDesktopReview(githubRef, {
      headSha: 'a'.repeat(40),
      statuses: { architecture: 'reviewed' },
      notes: { architecture: 'Provider boundary is clean.' },
      selectedSectionId: 'architecture',
      updatedAt: 123
    })).toBe(true);
    window.localStorage.setItem(desktopReviewStorageKey(githubRef), JSON.stringify({
      ...readDesktopReview(githubRef),
      statuses: { architecture: 'reviewed', bad: 'definitely-not-a-status' }
    }));

    expect(readDesktopReview(githubRef)).toMatchObject({
      statuses: { architecture: 'reviewed' },
      notes: { architecture: 'Provider boundary is clean.' }
    });
  });

  it('stores provider-neutral recent reviews without mixing identities', () => {
    expect(touchRecentDesktopReview(githubReview)).toHaveLength(1);
    expect(readRecentDesktopReviews()[0]).toMatchObject({
      ref: githubRef,
      title: 'Add a GitHub adapter',
      repositoryPath: 'ReviewFlow/Desktop'
    });
    expect(touchRecentDesktopReview({ ...githubReview, title: 'Updated title' })).toHaveLength(1);
    expect(readRecentDesktopReviews()[0].title).toBe('Updated title');
  });
});
