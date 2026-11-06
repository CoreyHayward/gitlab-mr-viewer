import type { FilterOptions, GitLabUser } from '@/types/gitlab';

export type QuickFilter = 'my-open-prs' | 'needs-approval' | 'not-reviewed-by-me';

export const previousURLForQuickFilter = (activeCustomId: string | null, previousURL: string | null): string | null =>
  activeCustomId === null ? null : previousURL ?? '';

export const applyQuickFilter = (
  filters: FilterOptions,
  quickFilter: QuickFilter | null,
  currentUser: GitLabUser | null
): FilterOptions => {
  switch (quickFilter) {
    case 'my-open-prs':
      return currentUser ? { ...filters, state: 'opened', approvalState: undefined, authors: [currentUser.username] } : filters;
    case 'needs-approval':
      return { ...filters, state: 'opened', approvalState: 'needs-approval' };
    case 'not-reviewed-by-me':
      return { ...filters, state: 'opened', approvalState: undefined, notReviewedByMe: true };
    default:
      return filters;
  }
};
