import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearGuidedReviewURL,
  decodeFiltersFromURL,
  decodeGuidedReviewFromURL,
  encodeFiltersToURL,
  isGuidedReviewHistoryEntry,
  pushGuidedReviewURL,
  updateURL
} from '@/utils/urlState';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('guided review URL state', () => {
  it('round-trips the needs approval filter state', () => {
    const encoded = encodeFiltersToURL({ approvalState: 'needs-approval' });

    expect(encoded).toBe('approvalState=needs-approval');
    expect(decodeFiltersFromURL(new URLSearchParams(encoded)).filters.approvalState).toBe('needs-approval');
  });

  it('decodes a guided review target alongside existing filters', () => {
    const result = decodeFiltersFromURL(new URLSearchParams('project=42&title=auth&reviewProject=42&reviewIid=17'));

    expect(result.filters).toMatchObject({ title: 'auth' });
    expect(result.projectIds).toEqual([42]);
    expect(result.guidedReview).toEqual({ projectId: 42, iid: 17 });
  });

  it('ignores incomplete or invalid guided review targets', () => {
    expect(decodeGuidedReviewFromURL(new URLSearchParams('reviewProject=42'))).toBeNull();
    expect(decodeGuidedReviewFromURL(new URLSearchParams('reviewProject=-1&reviewIid=17'))).toBeNull();
    expect(decodeGuidedReviewFromURL(new URLSearchParams('reviewProject=42.5&reviewIid=17'))).toBeNull();
  });

  it('keeps guided review state when filter URLs are encoded separately', () => {
    const encodedFilters = encodeFiltersToURL({ state: 'closed', title: 'auth' }, [42]);
    const searchParams = new URLSearchParams(encodedFilters);
    searchParams.set('reviewProject', '42');
    searchParams.set('reviewIid', '17');

    expect(decodeFiltersFromURL(searchParams).guidedReview).toEqual({ projectId: 42, iid: 17 });
  });

  it('pushes and clears guided review history without losing filters', () => {
    let href = 'https://viewer.example.test/?project=42&title=auth';
    let state: Record<string, unknown> | null = null;
    const history = {
      get state() {
        return state;
      },
      pushState(nextState: Record<string, unknown>, _title: string, nextUrl: string) {
        state = nextState;
        href = nextUrl;
      },
      replaceState(nextState: Record<string, unknown>, _title: string, nextUrl: string) {
        state = nextState;
        href = nextUrl;
      }
    };
    vi.stubGlobal('window', {
      get location() {
        return { href };
      },
      history
    });

    pushGuidedReviewURL({ projectId: 42, iid: 17 });
    expect(new URL(href).searchParams).toEqual(new URLSearchParams('project=42&title=auth&reviewProject=42&reviewIid=17'));
    expect(isGuidedReviewHistoryEntry()).toBe(true);

    updateURL({ state: 'closed' }, [42]);
    expect(new URL(href).searchParams).toEqual(new URLSearchParams('project=42&state=closed&reviewProject=42&reviewIid=17'));

    clearGuidedReviewURL();
    expect(new URL(href).searchParams).toEqual(new URLSearchParams('project=42&state=closed'));
    expect(isGuidedReviewHistoryEntry()).toBe(false);
  });
});
