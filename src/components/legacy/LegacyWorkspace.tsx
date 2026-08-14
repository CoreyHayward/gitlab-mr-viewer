'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Bookmark, Eye, GitBranch, History, Link, Search, Settings2, TriangleAlert, User, X } from 'lucide-react';
import AutoRefreshControl from '@/components/AutoRefreshControl';
import { GitLabService } from '@/services/gitlab';
import { FilterOptions, GitLabMergeRequest, GitLabProject, GitLabUser } from '@/types/gitlab';
import { loadUIState, saveUIState } from '@/utils/uiState';
import MergeRequestList from '@/components/MergeRequestList';
import LegacyFilterPanel from './LegacyFilterPanel';
import LegacyMergeTrainWatcher from './LegacyMergeTrainWatcher';
import LegacyProjectSelector from './LegacyProjectSelector';
import { MAX_CUSTOM_QUICK_FILTER_NAME_LENGTH, type CustomQuickFilter } from '@/utils/customQuickFilters';

export type LegacyQuickFilter = 'my-open-prs' | 'needs-approval' | 'not-reviewed-by-me' | 'recently-merged-prs';

const matchesMergeRequestSearch = (mergeRequest: GitLabMergeRequest, searchTerm: string) => {
  const searchableFields = [
    mergeRequest.title,
    mergeRequest.description,
    `#${mergeRequest.iid}`,
    `!${mergeRequest.iid}`,
    mergeRequest.author.name,
    mergeRequest.author.username,
    mergeRequest.project?.name,
    mergeRequest.project?.path_with_namespace,
    mergeRequest.source_branch,
    mergeRequest.target_branch,
    ...mergeRequest.labels
  ];

  return searchableFields.some((field) => field?.toLowerCase().includes(searchTerm));
};

interface LegacyWorkspaceProps {
  service: GitLabService;
  selectedProjects: GitLabProject[];
  onProjectsChange: (projects: GitLabProject[]) => void;
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  customQuickFilters: CustomQuickFilter[];
  activeCustomQuickFilterId: string | null;
  canSaveCustomQuickFilters: boolean;
  onApplyCustomQuickFilter: (filter: CustomQuickFilter) => void;
  onSaveCustomQuickFilter: (name: string) => boolean;
  onRemoveCustomQuickFilter: (id: string) => void;
  mergeRequests: GitLabMergeRequest[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  warnings: string[];
  hasMore: boolean;
  currentUser: GitLabUser | null;
  quickFilter: LegacyQuickFilter | null;
  onQuickFilterToggle: (filter: LegacyQuickFilter) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onShare: () => void;
  shareNotice: string | null;
  onDismissShareNotice: () => void;
  onOpenConnectionSettings: () => void;
  autoRefreshEnabled: boolean;
  onAutoRefreshEnabledChange: (enabled: boolean) => void;
  onStartSemanticReview: (mergeRequest: GitLabMergeRequest) => void;
}

export default function LegacyWorkspace({
  service,
  selectedProjects,
  onProjectsChange,
  filters,
  onFiltersChange,
  customQuickFilters,
  activeCustomQuickFilterId,
  canSaveCustomQuickFilters,
  onApplyCustomQuickFilter,
  onSaveCustomQuickFilter,
  onRemoveCustomQuickFilter,
  mergeRequests,
  loading,
  loadingMore,
  error,
  warnings,
  hasMore,
  currentUser,
  quickFilter,
  onQuickFilterToggle,
  onRefresh,
  onLoadMore,
  onShare,
  shareNotice,
  onDismissShareNotice,
  onOpenConnectionSettings,
  autoRefreshEnabled,
  onAutoRefreshEnabledChange,
  onStartSemanticReview
}: LegacyWorkspaceProps) {
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [mergeTrainWatcherVisible, setMergeTrainWatcherVisible] = useState(true);
  const [mergeTrainWatcherTrainMode, setMergeTrainWatcherTrainMode] = useState(false);
  const [mergeRequestSearch, setMergeRequestSearch] = useState('');
  const [isSavingCustomQuickFilter, setIsSavingCustomQuickFilter] = useState(false);
  const [customQuickFilterName, setCustomQuickFilterName] = useState('');
  const [customQuickFilterError, setCustomQuickFilterError] = useState<string | null>(null);
  const deferredMergeRequestSearch = useDeferredValue(mergeRequestSearch);

  const isMergeRequestSearchActive = deferredMergeRequestSearch.trim().length > 0;
  const visibleMergeRequests = useMemo(() => {
    const searchTerm = deferredMergeRequestSearch.trim().toLowerCase();
    if (!searchTerm) return mergeRequests;

    return mergeRequests.filter((mergeRequest) => matchesMergeRequestSearch(mergeRequest, searchTerm));
  }, [deferredMergeRequestSearch, mergeRequests]);

  useEffect(() => {
    const savedUIState = loadUIState();
    if (savedUIState.filtersExpanded !== undefined) setFiltersExpanded(savedUIState.filtersExpanded);
    if (savedUIState.mergeTrainWatcherVisible !== undefined) setMergeTrainWatcherVisible(savedUIState.mergeTrainWatcherVisible);
  }, []);

  const toggleFilters = () => {
    const expanded = !filtersExpanded;
    setFiltersExpanded(expanded);
    saveUIState({ filtersExpanded: expanded });
  };

  const setMergeTrainVisibility = (visible: boolean) => {
    setMergeTrainWatcherVisible(visible);
    if (!visible) setMergeTrainWatcherTrainMode(false);
    saveUIState({ mergeTrainWatcherVisible: visible });
  };

  const primaryActionClassName = 'inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-900';
  const secondaryActionClassName = 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-200 dark:hover:border-neutral-600 dark:hover:bg-neutral-700 dark:focus:ring-neutral-500 dark:focus:ring-offset-neutral-900';

  const quickFilterClassName = (filter: LegacyQuickFilter, activeClassName: string) => `inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
    quickFilter === filter
      ? activeClassName
      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700'
  }`;

  const customQuickFilterClassName = (filter: CustomQuickFilter) => `inline-flex max-w-full items-center rounded-full border text-sm font-medium transition-colors ${
    activeCustomQuickFilterId === filter.id
      ? 'border-gray-400 bg-gray-100 text-gray-900 dark:border-neutral-500 dark:bg-neutral-700 dark:text-white'
      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700'
  }`;

  const openCustomQuickFilterForm = () => {
    setCustomQuickFilterError(null);
    setCustomQuickFilterName('');
    setIsSavingCustomQuickFilter(true);
  };

  const closeCustomQuickFilterForm = () => {
    setCustomQuickFilterError(null);
    setCustomQuickFilterName('');
    setIsSavingCustomQuickFilter(false);
  };

  const saveCurrentCustomQuickFilter = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = customQuickFilterName.trim();
    if (!name) {
      setCustomQuickFilterError('Enter a name for this filter.');
      return;
    }
    if (!onSaveCustomQuickFilter(name)) {
      setCustomQuickFilterError('This filter could not be saved in browser storage.');
      return;
    }
    closeCustomQuickFilterForm();
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-neutral-900">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">GitLab MR Viewer</h1>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white/80 p-1.5 shadow-sm backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-800/80">
            <AutoRefreshControl loading={loading} onRefresh={onRefresh} autoRefreshEnabled={autoRefreshEnabled} onAutoRefreshEnabledChange={onAutoRefreshEnabledChange} className={primaryActionClassName} />
            <button type="button" onClick={onShare} className={secondaryActionClassName}><Link className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />Share URL</button>
            {!mergeTrainWatcherVisible && (
              <button type="button" onClick={() => setMergeTrainVisibility(true)} className={secondaryActionClassName}><GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400" />Merge Trains</button>
            )}
            <button type="button" onClick={onOpenConnectionSettings} className={secondaryActionClassName}><Settings2 className="h-4 w-4 text-gray-500 dark:text-gray-400" />Connection settings</button>
          </div>
        </div>

        <div className={mergeTrainWatcherVisible
          ? mergeTrainWatcherTrainMode
            ? 'space-y-6'
            : 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start [@media(min-width:2304px)]:relative [@media(min-width:2304px)]:block'
          : ''}
        >
          {mergeTrainWatcherVisible && mergeTrainWatcherTrainMode && (
            <aside>
              <LegacyMergeTrainWatcher service={service} onHide={() => setMergeTrainVisibility(false)} trainModeEnabled={mergeTrainWatcherTrainMode} onTrainModeChange={setMergeTrainWatcherTrainMode} />
            </aside>
          )}

          <main className="min-w-0">
            <div className="relative z-20 mb-6 flex flex-wrap items-center gap-2">
              <LegacyProjectSelector service={service} selectedProjects={selectedProjects} onProjectsChange={onProjectsChange} />
              <LegacyFilterPanel filters={filters} onFiltersChange={onFiltersChange} isExpanded={filtersExpanded} onToggle={toggleFilters} service={service} />
            </div>

            {shareNotice && (
              <div className="mb-6 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100" role="status">
                <span className="min-w-0 flex-1 break-words">{shareNotice}</span>
                <button type="button" onClick={onDismissShareNotice} className="rounded p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/40" aria-label="Dismiss share message"><X className="h-4 w-4" /></button>
              </div>
            )}

            {error && (
              <div className="mb-6 rounded-md border border-red-400 bg-red-100 p-4 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400" role="alert">
                <div className="whitespace-pre-line">{error}</div>
              </div>
            )}

            {!error && warnings.length > 0 && (
              <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="status">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Some GitLab data could not be loaded. The results below may be incomplete.</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                    <button type="button" onClick={onRefresh} className="mt-3 font-semibold underline underline-offset-2 hover:no-underline">Retry the current view</button>
                  </div>
                </div>
              </div>
            )}

            {!error && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onQuickFilterToggle('my-open-prs')} disabled={!currentUser} className={`${quickFilterClassName('my-open-prs', 'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200')} ${!currentUser ? 'cursor-not-allowed opacity-60' : ''}`}><User className="mr-2 h-4 w-4" />My Open MRs</button>
                <button type="button" onClick={() => onQuickFilterToggle('needs-approval')} className={quickFilterClassName('needs-approval', 'border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200')}><TriangleAlert className="mr-2 h-4 w-4" />Needs approval</button>
                <button type="button" onClick={() => onQuickFilterToggle('recently-merged-prs')} className={quickFilterClassName('recently-merged-prs', 'border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200')}><History className="mr-2 h-4 w-4" />Recently merged MRs</button>
                <button type="button" onClick={() => onQuickFilterToggle('not-reviewed-by-me')} disabled={!currentUser} className={`${quickFilterClassName('not-reviewed-by-me', 'border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200')} ${!currentUser ? 'cursor-not-allowed opacity-60' : ''}`}><Eye className="mr-2 h-4 w-4" />Not approved by me</button>
                {customQuickFilters.map((customFilter) => (
                  <div key={customFilter.id} className={customQuickFilterClassName(customFilter)} title={customFilter.name}>
                    <button type="button" onClick={() => onApplyCustomQuickFilter(customFilter)} className="inline-flex min-w-0 items-center gap-2 rounded-l-full py-1.5 pl-3 pr-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:focus-visible:ring-neutral-500">
                      <Bookmark className="h-4 w-4 shrink-0" />
                      <span className="max-w-48 truncate">{customFilter.name}</span>
                    </button>
                    <button type="button" onClick={() => onRemoveCustomQuickFilter(customFilter.id)} aria-label={`Delete custom filter ${customFilter.name}`} className="rounded-r-full p-1.5 opacity-70 transition-opacity hover:bg-black/5 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:focus-visible:ring-neutral-500 dark:hover:bg-white/10">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={openCustomQuickFilterForm} disabled={!canSaveCustomQuickFilters} aria-label="Save current filter" title="Save current filter" className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-lg font-medium leading-none text-gray-700 shadow-sm transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200 dark:hover:border-neutral-500 dark:hover:bg-neutral-700">+</button>
              </div>
            )}

            {!error && isSavingCustomQuickFilter && (
              <form onSubmit={saveCurrentCustomQuickFilter} className="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor="custom-quick-filter-name" className="block text-sm font-semibold text-gray-900 dark:text-white">Name this filter</label>
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">The current URL filter state will be saved in this browser.</p>
                  <input
                    id="custom-quick-filter-name"
                    type="text"
                    value={customQuickFilterName}
                    onChange={(event) => {
                      setCustomQuickFilterName(event.target.value);
                      setCustomQuickFilterError(null);
                    }}
                    maxLength={MAX_CUSTOM_QUICK_FILTER_NAME_LENGTH}
                    placeholder="e.g. Backend MRs awaiting review"
                    autoFocus
                    className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-neutral-600 dark:bg-neutral-800 dark:text-white dark:focus:ring-neutral-700"
                  />
                  {customQuickFilterError && <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-300" role="alert">{customQuickFilterError}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="submit" className="inline-flex items-center justify-center rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white dark:focus:ring-gray-400 dark:focus:ring-offset-neutral-900">Save filter</button>
                  <button type="button" onClick={closeCustomQuickFilterForm} className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700 dark:focus:ring-neutral-500 dark:focus:ring-offset-neutral-900">Cancel</button>
                </div>
              </form>
            )}

            {!error && (
              <div className="mb-4">
                <div className="relative w-full sm:max-w-xl">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    value={mergeRequestSearch}
                    onChange={(event) => setMergeRequestSearch(event.target.value)}
                    placeholder="Search loaded merge requests..."
                    aria-label="Search loaded merge requests"
                    className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-10 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 hover:border-gray-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-gray-500 dark:hover:border-neutral-600 dark:focus:border-violet-400 dark:focus:ring-violet-900/30"
                  />
                  {mergeRequestSearch && (
                    <button
                      type="button"
                      onClick={() => setMergeRequestSearch('')}
                      aria-label="Clear merge request search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-neutral-700 dark:hover:text-gray-200"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {!loading && !error && (
              <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                Showing {isMergeRequestSearchActive ? visibleMergeRequests.length : mergeRequests.length} loaded merge request{(isMergeRequestSearchActive ? visibleMergeRequests.length : mergeRequests.length) === 1 ? '' : 's'}{isMergeRequestSearchActive && ` matching "${deferredMergeRequestSearch.trim()}"`} {selectedProjects.length === 1 ? <>in <strong>{selectedProjects[0].path_with_namespace}</strong></> : selectedProjects.length > 1 ? <>across <strong>{selectedProjects.length} selected projects</strong></> : 'across your GitLab projects'}{hasMore ? '; more are available' : ''}.
              </div>
            )}

            <MergeRequestList
              mergeRequests={visibleMergeRequests}
              loading={loading}
              showProjectInfo={selectedProjects.length !== 1}
              loadingMessage={selectedProjects.length === 0 ? 'Loading merge requests across your projects...' : selectedProjects.length > 1 ? `Loading merge requests from ${selectedProjects.length} selected projects...` : undefined}
              emptyMessage={isMergeRequestSearchActive ? 'No merge requests match your search' : undefined}
              emptyDescription={isMergeRequestSearchActive ? 'Try a different search term or clear the search to see all loaded merge requests.' : undefined}
              onStartSemanticReview={onStartSemanticReview}
            />

            {!loading && !error && hasMore && (
              <div className="mt-6 flex justify-center">
                <button type="button" onClick={onLoadMore} disabled={loadingMore} className={secondaryActionClassName}>
                  {loadingMore ? 'Loading more…' : 'Load more merge requests'}
                </button>
              </div>
            )}
          </main>

          {mergeTrainWatcherVisible && !mergeTrainWatcherTrainMode && (
            <aside className="order-first xl:order-none xl:sticky xl:top-6 [@media(min-width:2304px)]:absolute [@media(min-width:2304px)]:left-full [@media(min-width:2304px)]:top-0 [@media(min-width:2304px)]:ml-6 [@media(min-width:2304px)]:w-[360px]">
              <LegacyMergeTrainWatcher service={service} onHide={() => setMergeTrainVisibility(false)} trainModeEnabled={mergeTrainWatcherTrainMode} onTrainModeChange={setMergeTrainWatcherTrainMode} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
