import { FilterOptions } from '@/types/gitlab';

const VALID_APPROVAL_STATES = new Set(['needs-review', 'needs-approval', 'partially-approved', 'approved']);
const GUIDED_REVIEW_PROJECT_PARAM = 'reviewProject';
const GUIDED_REVIEW_IID_PARAM = 'reviewIid';
const GUIDED_REVIEW_HISTORY_KEY = 'gitlabMrViewerGuidedReview';
export const MAX_SHARED_LIST_VALUES = 20;
export const MAX_SHARED_LIST_VALUE_LENGTH = 100;
export const MAX_SHARED_TEXT_LENGTH = 200;

export type GuidedReviewLocation = {
  projectId: number;
  iid: number;
};

const parsePositiveInteger = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeStringList = (values: string[]): string[] => Array.from(new Set(
  values.map((value) => value.trim().slice(0, MAX_SHARED_LIST_VALUE_LENGTH)).filter(Boolean)
)).slice(0, MAX_SHARED_LIST_VALUES);

const normalizeText = (value: string | null): string | null => value === null
  ? null
  : value.slice(0, MAX_SHARED_TEXT_LENGTH);

const SHARED_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

const normalizeDate = (value: string | null): string | null => {
  if (!value || value.length > 64) return null;
  const match = value.match(SHARED_DATE_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!daysInMonth || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return null;
  if (!Number.isFinite(Date.parse(value))) return null;
  return value;
};

const normalizeProjectIds = (values: number[]): number[] => Array.from(new Set(
  values.filter((value) => Number.isSafeInteger(value) && value > 0)
)).slice(0, MAX_SHARED_LIST_VALUES);

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
  const safeProjectIds = normalizeProjectIds(projectIds ?? []);
  
  if (safeProjectIds.length === 1) {
    params.set('project', safeProjectIds[0].toString());
  }

  if (safeProjectIds.length > 1) {
    params.set('projectIds', safeProjectIds.join(','));
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
    params.set('authors', normalizeStringList(filters.authors).join(','));
  }
  
  if (filters.title) {
    params.set('title', filters.title.slice(0, MAX_SHARED_TEXT_LENGTH));
  }
  
  if (filters.excludeTitle) {
    params.set('excludeTitle', filters.excludeTitle.slice(0, MAX_SHARED_TEXT_LENGTH));
  }
  
  if (filters.draft !== undefined) {
    params.set('draft', filters.draft.toString());
  }
  
  if (filters.dateFrom) {
    params.set('dateFrom', filters.dateFrom.slice(0, 64));
  }
  
  if (filters.dateTo) {
    params.set('dateTo', filters.dateTo.slice(0, 64));
  }

  if (filters.mergedAfter) {
    params.set('mergedAfter', filters.mergedAfter.slice(0, 64));
  }

  if (filters.projects && filters.projects.length > 0) {
    params.set('projects', normalizeStringList(filters.projects).join(','));
  }
  
  return params.toString();
};

export const decodeFiltersFromURL = (searchParams: URLSearchParams): { filters: FilterOptions; projectIds?: number[]; guidedReview: GuidedReviewLocation | null } => {
  const filters: FilterOptions = { state: 'opened' };
  let projectIds: number[] | undefined;

  if (searchParams.has('projectIds')) {
    const ids = normalizeProjectIds(searchParams
      .get('projectIds')!
      .split(',')
      .map((id) => parsePositiveInteger(id.trim()))
      .filter((id): id is number => id !== null));

    if (ids.length > 0) {
      projectIds = ids;
    }
  }
  
  if (!projectIds && searchParams.has('project')) {
    const id = parsePositiveInteger(searchParams.get('project'));
    if (id !== null) {
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
    if (searchParams.get('notReviewedByMe') === 'true') filters.notReviewedByMe = true;
  }
  
  if (searchParams.has('authors')) {
    const authors = normalizeStringList(searchParams.get('authors')!.split(','));
    if (authors.length > 0) {
      filters.authors = authors;
    }
  }
  
  if (searchParams.has('title')) {
    filters.title = normalizeText(searchParams.get('title')) ?? undefined;
  }
  
  if (searchParams.has('excludeTitle')) {
    filters.excludeTitle = normalizeText(searchParams.get('excludeTitle')) ?? undefined;
  }
  
  if (searchParams.has('draft')) {
    const draft = searchParams.get('draft');
    if (draft === 'true' || draft === 'false') filters.draft = draft === 'true';
  }
  
  if (searchParams.has('dateFrom')) {
    filters.dateFrom = normalizeDate(searchParams.get('dateFrom')) ?? undefined;
  }
  
  if (searchParams.has('dateTo')) {
    filters.dateTo = normalizeDate(searchParams.get('dateTo')) ?? undefined;
  }

  if (searchParams.has('mergedAfter')) {
    filters.mergedAfter = normalizeDate(searchParams.get('mergedAfter')) ?? undefined;
  }

  if (searchParams.has('projects')) {
    const projects = normalizeStringList(searchParams.get('projects')!.split(','));
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
