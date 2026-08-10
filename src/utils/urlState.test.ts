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

  it('deduplicates, validates, and caps project IDs from shared URLs', () => {
    const values = ['1', '1', '-2', '3.5', 'nope', ...Array.from({ length: 30 }, (_, index) => String(index + 2))];
    const result = decodeFiltersFromURL(new URLSearchParams(`projectIds=${values.join(',')}`));

    expect(result.projectIds).toHaveLength(20);
    expect(result.projectIds?.slice(0, 3)).toEqual([1, 2, 3]);
    expect(result.projectIds?.every((id) => Number.isSafeInteger(id) && id > 0)).toBe(true);
  });

  it('caps author and project filter fan-out from URLs', () => {
    const many = Array.from({ length: 30 }, (_, index) => `value-${index}`).join(',');
    const { filters } = decodeFiltersFromURL(new URLSearchParams(`authors=${many}&projects=${many}`));

    expect(filters.authors).toHaveLength(20);
    expect(filters.projects).toHaveLength(20);
  });

  it('strictly decodes booleans, dates, and bounded free text', () => {
    const { filters } = decodeFiltersFromURL(new URLSearchParams({
      notReviewedByMe: 'false',
      draft: 'sometimes',
      dateFrom: 'not-a-date',
      mergedAfter: '2026-08-01T00:00:00.000Z',
      title: 'x'.repeat(500)
    }));

    expect(filters.notReviewedByMe).toBeUndefined();
    expect(filters.draft).toBeUndefined();
    expect(filters.dateFrom).toBeUndefined();
    expect(filters.mergedAfter).toBe('2026-08-01T00:00:00.000Z');
    expect(filters.title).toHaveLength(200);
  });

  it('rejects ambiguous and impossible date values accepted by permissive Date parsing', () => {
    const { filters } = decodeFiltersFromURL(new URLSearchParams({
      dateFrom: '1',
      dateTo: '2026-02-30',
      mergedAfter: '2026-08-01T25:00:00Z'
    }));

    expect(filters.dateFrom).toBeUndefined();
    expect(filters.dateTo).toBeUndefined();
    expect(filters.mergedAfter).toBeUndefined();
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
