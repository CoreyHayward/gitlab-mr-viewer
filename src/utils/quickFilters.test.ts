import { describe, expect, it } from 'vitest';
import { applyQuickFilter, previousURLForQuickFilter } from '@/utils/quickFilters';
import { decodeFiltersFromURL } from '@/utils/urlState';
import type { FilterOptions, GitLabUser } from '@/types/gitlab';

const currentUser: GitLabUser = {
  id: 7,
  username: 'corey',
  name: 'Corey Hayward',
  avatar_url: null
};

describe('quick merge request filters', () => {
  it.each(['my-open-prs', 'not-reviewed-by-me'] as const)('clears a previous approval selection when choosing %s', (view) => {
    const filters: FilterOptions = { state: 'opened', approvalState: 'partially-approved', title: 'team' };
    const result = applyQuickFilter(filters, view, currentUser);
    expect(result.approvalState).toBeUndefined();
    expect(result.title).toBe('team');
  });
  it.each(['my-open-prs', 'needs-approval', 'not-reviewed-by-me'] as const)('clears a previous project selection when choosing %s', (view) => {
    const result = applyQuickFilter({ state: 'opened', projects: ['group/viewer'] }, view, currentUser);
    expect(result.projects).toBeUndefined();
  });
  it('restores the previous filters when switching from a saved view to a built-in view', () => {
    const savedFilters = decodeFiltersFromURL(new URLSearchParams('approvalState=partially-approved')).filters;
    expect(savedFilters.approvalState).toBe('partially-approved');
    const previousURL = previousURLForQuickFilter('saved-view', '?title=team');
    const previousFilters = decodeFiltersFromURL(new URLSearchParams(previousURL ?? '')).filters;
    const nextFilters = applyQuickFilter(previousFilters, 'my-open-prs', currentUser);
    expect(nextFilters).toEqual({ state: 'opened', title: 'team', authors: ['corey'] });
    expect(nextFilters.approvalState).toBeUndefined();
    expect(previousURLForQuickFilter('saved-view', null)).toBe('');
    expect(previousURLForQuickFilter(null, '?title=team')).toBeNull();
  });
  it('exposes the active preset alongside the rest of the filters', () => {
    const baseFilters: FilterOptions = {
      state: 'merged',
      title: 'APPS'
    };

    const visibleFilters = applyQuickFilter(baseFilters, 'needs-approval', currentUser);
    const editedFilters = { ...visibleFilters, title: 'APPS-5183' };

    expect(visibleFilters).toEqual({
      state: 'opened',
      title: 'APPS',
      approvalState: 'needs-approval'
    });
    expect(editedFilters).toEqual({
      state: 'opened',
      title: 'APPS-5183',
      approvalState: 'needs-approval'
    });
  });

  it('makes quick views explicit when a state tab changes', () => {
    const activeFilters = applyQuickFilter({ title: 'APPS' }, 'needs-approval', currentUser);

    expect({ ...activeFilters, state: 'merged' }).toEqual({
      title: 'APPS',
      state: 'merged',
      approvalState: 'needs-approval'
    });
  });

});
