import { FilterOptions } from '@/types/gitlab';

export const encodeFiltersToURL = (filters: FilterOptions, projectId?: number): string => {
  const params = new URLSearchParams();
  
  if (projectId) {
    params.set('project', projectId.toString());
  }
  
  if (filters.state && filters.state !== 'opened') {
    params.set('state', filters.state);
  }
  
  if (filters.authors && filters.authors.length > 0) {
    params.set('authors', filters.authors.join(','));
  }
  
  if (filters.assignee) {
    params.set('assignee', filters.assignee);
  }
  
  if (filters.reviewer) {
    params.set('reviewer', filters.reviewer);
  }
  
  if (filters.labels && filters.labels.length > 0) {
    params.set('labels', filters.labels.join(','));
  }
  
  if (filters.sourceBranch) {
    params.set('sourceBranch', filters.sourceBranch);
  }
  
  if (filters.targetBranch) {
    params.set('targetBranch', filters.targetBranch);
  }
  
  if (filters.title) {
    params.set('title', filters.title);
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

  if (filters.projects && filters.projects.length > 0) {
    params.set('projects', filters.projects.join(','));
  }
  
  return params.toString();
};

export const decodeFiltersFromURL = (searchParams: URLSearchParams): { filters: FilterOptions; projectId?: number } => {
  const filters: FilterOptions = { state: 'opened' };
  let projectId: number | undefined;
  
  if (searchParams.has('project')) {
    const id = parseInt(searchParams.get('project')!);
    if (!isNaN(id)) {
      projectId = id;
    }
  }
  
  if (searchParams.has('state')) {
    const state = searchParams.get('state') as FilterOptions['state'];
    if (['opened', 'closed', 'merged', 'all'].includes(state!)) {
      filters.state = state;
    }
  }
  
  if (searchParams.has('authors')) {
    const authors = searchParams.get('authors')!.split(',').map(a => a.trim()).filter(a => a.length > 0);
    if (authors.length > 0) {
      filters.authors = authors;
    }
  }
  
  if (searchParams.has('assignee')) {
    filters.assignee = searchParams.get('assignee')!;
  }
  
  if (searchParams.has('reviewer')) {
    filters.reviewer = searchParams.get('reviewer')!;
  }
  
  if (searchParams.has('labels')) {
    const labels = searchParams.get('labels')!.split(',').map(l => l.trim()).filter(l => l.length > 0);
    if (labels.length > 0) {
      filters.labels = labels;
    }
  }
  
  if (searchParams.has('sourceBranch')) {
    filters.sourceBranch = searchParams.get('sourceBranch')!;
  }
  
  if (searchParams.has('targetBranch')) {
    filters.targetBranch = searchParams.get('targetBranch')!;
  }
  
  if (searchParams.has('title')) {
    filters.title = searchParams.get('title')!;
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

  if (searchParams.has('projects')) {
    const projects = searchParams.get('projects')!.split(',').map(p => p.trim()).filter(p => p.length > 0);
    if (projects.length > 0) {
      filters.projects = projects;
    }
  }
  
  return { filters, projectId };
};

export const updateURL = (filters: FilterOptions, projectId?: number) => {
  const url = new URL(window.location.href);
  const queryString = encodeFiltersToURL(filters, projectId);
  
  if (queryString) {
    url.search = '?' + queryString;
  } else {
    url.search = '';
  }
  
  window.history.replaceState({}, '', url.toString());
};
