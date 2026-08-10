import { FilterOptions } from '@/types/gitlab';

const VALID_APPROVAL_STATES = new Set(['needs-review', 'partially-approved', 'approved']);
const GUIDED_REVIEW_PROJECT_PARAM = 'reviewProject';
const GUIDED_REVIEW_IID_PARAM = 'reviewIid';
const GUIDED_REVIEW_HISTORY_KEY = 'gitlabMrViewerGuidedReview';

export type GuidedReviewLocation = {
  projectId: number;
  iid: number;
};

const parsePositiveInteger = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const decodeGuidedReviewFromURL = (searchParams: URLSearchParams): GuidedReviewLocation | null => {
  const projectId = parsePositiveInteger(searchParams.get(GUIDED_REVIEW_PROJECT_PARAM));
  const iid = parsePositiveInteger(searchParams.get(GUIDED_REVIEW_IID_PARAM));
  return projectId && iid ? { projectId, iid } : null;
};

const setGuidedReviewParams = (url: URL, guidedReview: GuidedReviewLocation | null) => {
  if (guidedReview) {
    url.searchParams.set(GUIDED_REVIEW_PROJECT_PARAM, guidedReview.projectId.toString());
    url.searchParams.set(GUIDED_REVIEW_IID_PARAM, guidedReview.iid.toString());
  } else {
    url.searchParams.delete(GUIDED_REVIEW_PROJECT_PARAM);
    url.searchParams.delete(GUIDED_REVIEW_IID_PARAM);
  }
};

const withoutGuidedReviewHistoryMarker = (state: unknown): Record<string, unknown> => {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {};
  const nextState = { ...(state as Record<string, unknown>) };
  delete nextState[GUIDED_REVIEW_HISTORY_KEY];
  return nextState;
};

export const encodeFiltersToURL = (filters: FilterOptions, projectIds?: number[]): string => {
  const params = new URLSearchParams();
  
  if (projectIds && projectIds.length === 1) {
    params.set('project', projectIds[0].toString());
  }

  if (projectIds && projectIds.length > 1) {
    params.set('projectIds', projectIds.join(','));
  }
  
  if (filters.state && filters.state !== 'opened') {
    params.set('state', filters.state);
  }

  if (filters.approvalState) {
    params.set('approvalState', filters.approvalState);
  }

  if (filters.notReviewedByMe) {
    params.set('notReviewedByMe', 'true');
  }
  
  if (filters.authors && filters.authors.length > 0) {
    params.set('authors', filters.authors.join(','));
  }
  
  if (filters.title) {
    params.set('title', filters.title);
  }
  
  if (filters.excludeTitle) {
    params.set('excludeTitle', filters.excludeTitle);
  }
  
  if (filters.draft !== undefined) {
    params.set('draft', filters.draft.toString());
  }
  
  if (filters.dateFrom) {
    params.set('dateFrom', filters.dateFrom);
  }
  
  if (filters.dateTo) {
    params.set('dateTo', filters.dateTo);
  }

  if (filters.mergedAfter) {
    params.set('mergedAfter', filters.mergedAfter);
  }

  if (filters.projects && filters.projects.length > 0) {
    params.set('projects', filters.projects.join(','));
  }
  
  return params.toString();
};

export const decodeFiltersFromURL = (searchParams: URLSearchParams): { filters: FilterOptions; projectIds?: number[]; guidedReview: GuidedReviewLocation | null } => {
  const filters: FilterOptions = { state: 'opened' };
  let projectIds: number[] | undefined;

  if (searchParams.has('projectIds')) {
    const ids = searchParams
      .get('projectIds')!
      .split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id));

    if (ids.length > 0) {
      projectIds = ids;
    }
  }
  
  if (!projectIds && searchParams.has('project')) {
    const id = parseInt(searchParams.get('project')!);
    if (!isNaN(id)) {
      projectIds = [id];
    }
  }
  
  if (searchParams.has('state')) {
    const state = searchParams.get('state') as FilterOptions['state'];
    if (['opened', 'closed', 'merged', 'all'].includes(state!)) {
      filters.state = state;
    }
  }

  if (searchParams.has('approvalState')) {
    const approvalState = searchParams.get('approvalState');
    if (approvalState && VALID_APPROVAL_STATES.has(approvalState)) {
      filters.approvalState = approvalState as FilterOptions['approvalState'];
    }
  }

  if (searchParams.has('notReviewedByMe')) {
    filters.notReviewedByMe = searchParams.get('notReviewedByMe') === 'true';
  }
  
  if (searchParams.has('authors')) {
    const authors = searchParams.get('authors')!.split(',').map(a => a.trim()).filter(a => a.length > 0);
    if (authors.length > 0) {
      filters.authors = authors;
    }
  }
  
  if (searchParams.has('title')) {
    filters.title = searchParams.get('title')!;
  }
  
  if (searchParams.has('excludeTitle')) {
    filters.excludeTitle = searchParams.get('excludeTitle')!;
  }
  
  if (searchParams.has('draft')) {
    filters.draft = searchParams.get('draft') === 'true';
  }
  
  if (searchParams.has('dateFrom')) {
    filters.dateFrom = searchParams.get('dateFrom')!;
  }
  
  if (searchParams.has('dateTo')) {
    filters.dateTo = searchParams.get('dateTo')!;
  }

  if (searchParams.has('mergedAfter')) {
    filters.mergedAfter = searchParams.get('mergedAfter')!;
  }

  if (searchParams.has('projects')) {
    const projects = searchParams.get('projects')!.split(',').map(p => p.trim()).filter(p => p.length > 0);
    if (projects.length > 0) {
      filters.projects = projects;
    }
  }
  
  return { filters, projectIds, guidedReview: decodeGuidedReviewFromURL(searchParams) };
};

export const updateURL = (filters: FilterOptions, projectIds?: number[], guidedReview?: GuidedReviewLocation | null) => {
  const url = new URL(window.location.href);
  const currentGuidedReview = guidedReview === undefined
    ? decodeGuidedReviewFromURL(url.searchParams)
    : guidedReview;
  const queryString = encodeFiltersToURL(filters, projectIds);
  
  if (queryString) {
    url.search = '?' + queryString;
  } else {
    url.search = '';
  }
  
  setGuidedReviewParams(url, currentGuidedReview);
  window.history.replaceState(window.history.state, '', url.toString());
};

export const pushGuidedReviewURL = (guidedReview: GuidedReviewLocation) => {
  const url = new URL(window.location.href);
  setGuidedReviewParams(url, guidedReview);
  const currentState = window.history.state;
  const nextState = currentState && typeof currentState === 'object' && !Array.isArray(currentState)
    ? { ...(currentState as Record<string, unknown>), [GUIDED_REVIEW_HISTORY_KEY]: true }
    : { [GUIDED_REVIEW_HISTORY_KEY]: true };
  window.history.pushState(nextState, '', url.toString());
};

export const clearGuidedReviewURL = () => {
  const url = new URL(window.location.href);
  setGuidedReviewParams(url, null);
  window.history.replaceState(withoutGuidedReviewHistoryMarker(window.history.state), '', url.toString());
};

export const isGuidedReviewHistoryEntry = (): boolean => {
  const state = window.history.state;
  return Boolean(state && typeof state === 'object' && !Array.isArray(state) && (state as Record<string, unknown>)[GUIDED_REVIEW_HISTORY_KEY] === true);
};
