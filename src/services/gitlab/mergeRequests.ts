import type { FilterOptions, GitLabMergeRequest } from '@/types/gitlab';
import { matchesApprovalFilter } from '@/utils/approvalState';

const MAX_SERVER_FILTERED_TARGETS = 40;
const DEFAULT_MERGE_REQUEST_PAGE_SIZE = 50;

export type MergeRequestQueryTarget = {
  endpoint: string;
  label: string;
  page: number;
  perPage: number;
};

export type MergeRequestPageCursor = {
  targets: MergeRequestQueryTarget[];
  projectDiscovery?: {
    page: number;
    perPage: number;
  };
};

export type MergeRequestLoadResult = {
  mergeRequests: GitLabMergeRequest[];
  nextCursor: MergeRequestPageCursor | null;
  warnings: string[];
};

export const mergeRequestSortTimestamp = (mergeRequest: GitLabMergeRequest, filters: FilterOptions) => {
  if (filters.mergedAfter && mergeRequest.merged_at) return new Date(mergeRequest.merged_at).getTime();
  return new Date(mergeRequest.updated_at).getTime();
};

export const uniqueStrings = (values: string[] | undefined) => Array.from(new Set(
  (values ?? []).map((value) => value.trim()).filter(Boolean)
));

const buildQuery = (filters: FilterOptions, authorUsername?: string, globalScope = false) => {
  const params = new URLSearchParams();
  if (filters.state && filters.state !== 'all') params.set('state', filters.state);
  if (authorUsername) params.set('author_username', authorUsername);
  if (filters.dateFrom) params.set('created_after', filters.dateFrom);
  if (filters.dateTo) params.set('created_before', filters.dateTo);
  if (filters.mergedAfter) params.set('updated_after', filters.mergedAfter);
  if (globalScope) params.set('scope', 'all');
  params.set('order_by', filters.mergedAfter ? 'merged_at' : 'updated_at');
  params.set('sort', 'desc');
  return params;
};

export const buildMergeRequestTargets = (
  bases: Array<{ endpoint: string; label: string; globalScope?: boolean; perPage?: number }>,
  filters: FilterOptions
): MergeRequestQueryTarget[] => {
  const authors = uniqueStrings(filters.authors);
  const authorQueries = authors.length > 0 && authors.length * bases.length <= MAX_SERVER_FILTERED_TARGETS
    ? authors
    : [undefined];

  return bases.flatMap((base) => authorQueries.map((author) => ({
    endpoint: `${base.endpoint}?${buildQuery(filters, author, base.globalScope).toString()}`,
    label: author ? `${base.label} for @${author}` : base.label,
    page: 1,
    perPage: base.perPage ?? DEFAULT_MERGE_REQUEST_PAGE_SIZE
  })));
};

export const applyMergeRequestFilters = (
  mergeRequests: GitLabMergeRequest[],
  filters: FilterOptions,
  currentUsername?: string
): GitLabMergeRequest[] => {
  const projectFilters = uniqueStrings(filters.projects).map((project) => project.toLowerCase());
  const authorFilters = uniqueStrings(filters.authors).map((author) => author.toLowerCase());

  return mergeRequests.filter((mergeRequest) => {
    const title = mergeRequest.title.toLowerCase();
    if (authorFilters.length > 0 && !authorFilters.includes(mergeRequest.author.username.toLowerCase())) return false;
    if (filters.title && !title.includes(filters.title.toLowerCase())) return false;
    if (filters.excludeTitle && title.includes(filters.excludeTitle.toLowerCase())) return false;
    if (filters.draft !== undefined && mergeRequest.draft !== filters.draft) return false;

    if (projectFilters.length > 0) {
      const projectName = mergeRequest.project?.name.toLowerCase();
      const projectPath = mergeRequest.project?.path_with_namespace.toLowerCase();
      if (!projectFilters.some((project) => project === projectName || project === projectPath)) return false;
    }

    if (filters.mergedAfter && (
      !mergeRequest.merged_at || new Date(mergeRequest.merged_at).getTime() < new Date(filters.mergedAfter).getTime()
    )) return false;

    if (filters.approvalState && !matchesApprovalFilter(
      mergeRequest.approval_status,
      filters.approvalState,
      mergeRequest.state
    )) return false;

    if (filters.notReviewedByMe) {
      if (mergeRequest.state !== 'opened' || !mergeRequest.approval_status || !currentUsername) return false;
      const normalizedCurrentUsername = currentUsername.toLowerCase();
      if (mergeRequest.approval_status.approved_by.some(({ user }) => user.username.toLowerCase() === normalizedCurrentUsername)) return false;
    }

    return true;
  });
};
