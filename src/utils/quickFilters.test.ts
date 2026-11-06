import { describe, expect, it } from 'vitest';
import { applyQuickFilter } from '@/utils/quickFilters';
import type { FilterOptions, GitLabUser } from '@/types/gitlab';

const currentUser: GitLabUser = {
  id: 7,
  username: 'corey',
  name: 'Corey Hayward',
  avatar_url: null
};

describe('quick merge request filters', () => {
  it('exposes the active preset alongside the rest of the filters', () => {
    const baseFilters: FilterOptions = {
      state: 'merged',
      title: 'APPS',
      projects: ['group/frontend']
    };

    const visibleFilters = applyQuickFilter(baseFilters, 'needs-approval', currentUser);
    const editedFilters = { ...visibleFilters, title: 'APPS-5183' };

    expect(visibleFilters).toEqual({
      state: 'opened',
      title: 'APPS',
      projects: ['group/frontend'],
      approvalState: 'needs-approval'
    });
    expect(editedFilters).toEqual({
      state: 'opened',
      title: 'APPS-5183',
      projects: ['group/frontend'],
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
