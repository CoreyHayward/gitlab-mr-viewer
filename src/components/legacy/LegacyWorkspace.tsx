'use client';

import { useEffect, useState } from 'react';
import { Eye, GitBranch, History, Link, LogOut, RefreshCcw, TriangleAlert, User } from 'lucide-react';
import { GitLabService } from '@/services/gitlab';
import { FilterOptions, GitLabMergeRequest, GitLabProject, GitLabUser } from '@/types/gitlab';
import { loadUIState, saveUIState } from '@/utils/uiState';
import MergeRequestList from '@/components/MergeRequestList';
import LegacyFilterPanel from './LegacyFilterPanel';
import LegacyMergeTrainWatcher from './LegacyMergeTrainWatcher';
import LegacyProjectSelector from './LegacyProjectSelector';

export type LegacyQuickFilter = 'my-open-prs' | 'needs-approval' | 'not-reviewed-by-me' | 'recently-merged-prs';

interface LegacyWorkspaceProps {
  service: GitLabService;
  selectedProjects: GitLabProject[];
  onProjectsChange: (projects: GitLabProject[]) => void;
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  mergeRequests: GitLabMergeRequest[];
  loading: boolean;
  error: string | null;
  currentUser: GitLabUser | null;
  quickFilter: LegacyQuickFilter | null;
  onQuickFilterToggle: (filter: LegacyQuickFilter) => void;
  onRefresh: () => void;
  onShare: () => void;
  onDisconnect: () => void;
  onTryMergeDesk: () => void;
}

export default function LegacyWorkspace({
  service,
  selectedProjects,
  onProjectsChange,
  filters,
  onFiltersChange,
  mergeRequests,
  loading,
  error,
  currentUser,
  quickFilter,
  onQuickFilterToggle,
  onRefresh,
  onShare,
  onDisconnect,
  onTryMergeDesk
}: LegacyWorkspaceProps) {
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [mergeTrainWatcherVisible, setMergeTrainWatcherVisible] = useState(true);
  const [mergeTrainWatcherTrainMode, setMergeTrainWatcherTrainMode] = useState(false);

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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-neutral-900">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">GitLab MR Viewer</h1>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white/80 p-1.5 shadow-sm backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-800/80">
            <button type="button" onClick={onTryMergeDesk} className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-200 dark:hover:bg-indigo-900/40 dark:focus:ring-offset-neutral-900">
              <Eye className="h-4 w-4" />Try Merge Desk
            </button>
            <button type="button" onClick={onRefresh} disabled={loading} className={primaryActionClassName}>
              <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Refreshing...' : 'Refresh'}
            </button>
            {selectedProjects.length > 0 && (
              <button type="button" onClick={onShare} className={secondaryActionClassName}><Link className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />Share URL</button>
            )}
            {!mergeTrainWatcherVisible && (
              <button type="button" onClick={() => setMergeTrainVisibility(true)} className={secondaryActionClassName}><GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400" />Merge Trains</button>
            )}
            <button type="button" onClick={onDisconnect} className={secondaryActionClassName}><LogOut className="h-4 w-4 text-gray-500 dark:text-gray-400" />Disconnect</button>
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

            {error && (
              <div className="mb-6 rounded-md border border-red-400 bg-red-100 p-4 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400">
                <div className="whitespace-pre-line">{error}</div>
              </div>
            )}

            {!error && (
              <div className="mb-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => onQuickFilterToggle('my-open-prs')} disabled={!currentUser} className={`${quickFilterClassName('my-open-prs', 'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200')} ${!currentUser ? 'cursor-not-allowed opacity-60' : ''}`}><User className="mr-2 h-4 w-4" />My Open PRs</button>
                <button type="button" onClick={() => onQuickFilterToggle('needs-approval')} className={quickFilterClassName('needs-approval', 'border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200')}><TriangleAlert className="mr-2 h-4 w-4" />Needs approval</button>
                <button type="button" onClick={() => onQuickFilterToggle('recently-merged-prs')} className={quickFilterClassName('recently-merged-prs', 'border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200')}><History className="mr-2 h-4 w-4" />Recently merged MRs</button>
                <button type="button" onClick={() => onQuickFilterToggle('not-reviewed-by-me')} disabled={!currentUser} className={`${quickFilterClassName('not-reviewed-by-me', 'border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200')} ${!currentUser ? 'cursor-not-allowed opacity-60' : ''}`}><Eye className="mr-2 h-4 w-4" />Not reviewed by me</button>
              </div>
            )}

            {!loading && !error && (
              <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                Found {mergeRequests.length} merge request{mergeRequests.length === 1 ? '' : 's'} {selectedProjects.length === 1 ? <>in <strong>{selectedProjects[0].path_with_namespace}</strong></> : selectedProjects.length > 1 ? <>across <strong>{selectedProjects.length} selected projects</strong></> : 'across all projects'}
              </div>
            )}

            <MergeRequestList mergeRequests={mergeRequests} loading={loading} showProjectInfo={selectedProjects.length !== 1} loadingMessage={selectedProjects.length === 0 ? 'Loading merge requests across all projects...' : selectedProjects.length > 1 ? `Loading merge requests from ${selectedProjects.length} selected projects...` : undefined} />
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
