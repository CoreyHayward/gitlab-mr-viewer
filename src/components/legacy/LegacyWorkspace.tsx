'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Bookmark, ChevronDown, ChevronUp, Copy, Eye, GitBranch, GripVertical, Link, Pencil, Search, Settings2, TriangleAlert, User, X, type LucideIcon } from 'lucide-react';
import AutoRefreshControl from '@/components/AutoRefreshControl';
import { GitLabService } from '@/services/gitlab';
import { FilterOptions, GitLabMergeRequest, GitLabUser } from '@/types/gitlab';
import { loadUIState, saveUIState } from '@/utils/uiState';
import { getApprovalCategory } from '@/utils/approvalState';
import type { QuickFilter } from '@/utils/quickFilters';
import MergeRequestList from '@/components/MergeRequestList';
import LegacyFilterPanel from './LegacyFilterPanel';
import LegacyMergeTrainWatcher from './LegacyMergeTrainWatcher';
import { type CustomQuickFilter } from '@/utils/customQuickFilters';

export type LegacyQuickFilter = QuickFilter;
type MergeRequestSort = 'updated-desc' | 'updated-asc' | 'comments-desc' | 'size-desc';
type MergeRequestGroupBy = 'none' | 'project' | 'author' | 'review';

interface QuickFilterNavigationItem {
  id: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  disabled?: boolean;
  activeClassName: string;
  onActivate: () => void;
  onRemove?: () => void;
}

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
    ...mergeRequest.assignees.flatMap(({ name, username }) => [name, username]),
    ...mergeRequest.reviewers.flatMap(({ name, username }) => [name, username]),
    ...mergeRequest.labels
  ];

  return searchableFields.some((field) => field?.toLowerCase().includes(searchTerm));
};

interface LegacyWorkspaceProps {
  service: GitLabService;
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  customQuickFilters: CustomQuickFilter[];
  activeCustomQuickFilterId: string | null;
  canSaveCustomQuickFilters: boolean;
  onApplyCustomQuickFilter: (filter: CustomQuickFilter) => void;
  onRestoreCustomQuickFilter: (filter: CustomQuickFilter) => void;
  onSaveCustomQuickFilter: (name: string) => boolean;
  onUpdateCustomQuickFilter: (id: string) => boolean;
  onRemoveCustomQuickFilter: (id: string) => void;
  quickFilterOrder: string[];
  onQuickFilterOrderChange: (order: string[]) => void;
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
  filters,
  onFiltersChange,
  customQuickFilters,
  activeCustomQuickFilterId,
  canSaveCustomQuickFilters,
  onApplyCustomQuickFilter,
  onRestoreCustomQuickFilter,
  onSaveCustomQuickFilter,
  onUpdateCustomQuickFilter,
  onRemoveCustomQuickFilter,
  quickFilterOrder,
  onQuickFilterOrderChange,
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
  const [mobileWatcherOpen, setMobileWatcherOpen] = useState(false);
  const [mergeRequestSort, setMergeRequestSort] = useState<MergeRequestSort>('updated-desc');
  const [mergeRequestGroupBy, setMergeRequestGroupBy] = useState<MergeRequestGroupBy>('none');
  const [mergeRequestSearch, setMergeRequestSearch] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [editingSavedViewId, setEditingSavedViewId] = useState<string | null>(null);
  const [editSavedViewError, setEditSavedViewError] = useState(false);
  const [draggedQuickFilterId, setDraggedQuickFilterId] = useState<string | null>(null);
  const [editingQuickFilters, setEditingQuickFilters] = useState(false);
  const deferredMergeRequestSearch = useDeferredValue(mergeRequestSearch);
  const filteredProjects = filters.projects ?? [];

  const isMergeRequestSearchActive = deferredMergeRequestSearch.trim().length > 0;
  const visibleMergeRequests = useMemo(() => {
    const searchTerm = deferredMergeRequestSearch.trim().toLowerCase();
    if (!searchTerm) return mergeRequests;

    return mergeRequests.filter((mergeRequest) => matchesMergeRequestSearch(mergeRequest, searchTerm));
  }, [deferredMergeRequestSearch, mergeRequests]);

  const sortedMergeRequests = useMemo(() => [...visibleMergeRequests].sort((left, right) => {
    if (mergeRequestSort === 'comments-desc') return right.user_notes_count - left.user_notes_count;
    if (mergeRequestSort === 'size-desc') {
      if (!left.diff_stats || !right.diff_stats) return Number(Boolean(right.diff_stats)) - Number(Boolean(left.diff_stats));
      const leftSize = (left.diff_stats?.additions ?? 0) + (left.diff_stats?.deletions ?? 0);
      const rightSize = (right.diff_stats?.additions ?? 0) + (right.diff_stats?.deletions ?? 0);
      return rightSize - leftSize;
    }

    const updatedDifference = new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    return mergeRequestSort === 'updated-asc' ? -updatedDifference : updatedDifference;
  }), [mergeRequestSort, visibleMergeRequests]);

  const resultSummary = useMemo(() => ({
    needsApproval: visibleMergeRequests.filter((mergeRequest) => {
      const category = getApprovalCategory(mergeRequest);
      return category === 'needs-review' || category === 'partially-approved';
    }).length,
    drafts: visibleMergeRequests.filter((mergeRequest) => mergeRequest.draft).length,
    failedPipelines: visibleMergeRequests.filter((mergeRequest) => mergeRequest.pipeline?.status === 'failed').length
  }), [visibleMergeRequests]);
  const selectedState = filters.state ?? 'opened';

  useEffect(() => {
    const savedUIState = loadUIState();
    if (savedUIState.filtersExpanded !== undefined) setFiltersExpanded(savedUIState.filtersExpanded);
    if (savedUIState.mergeTrainWatcherVisible !== undefined) setMergeTrainWatcherVisible(savedUIState.mergeTrainWatcherVisible);
    if (savedUIState.mergeRequestSort) setMergeRequestSort(savedUIState.mergeRequestSort);
    if (savedUIState.mergeRequestGroupBy) setMergeRequestGroupBy(savedUIState.mergeRequestGroupBy);
  }, []);

  const toggleFilters = () => {
    if (filtersExpanded && editingSavedViewId) {
      const savedView = customQuickFilters.find((view) => view.id === editingSavedViewId);
      if (savedView) onRestoreCustomQuickFilter(savedView);
      setEditingSavedViewId(null);
      setEditSavedViewError(false);
    }
    const expanded = !filtersExpanded;
    setFiltersExpanded(expanded);
    saveUIState({ filtersExpanded: expanded });
  };

  const setMergeTrainVisibility = (visible: boolean) => {
    setMergeTrainWatcherVisible(visible);
    if (!visible) setMergeTrainWatcherTrainMode(false);
    saveUIState({ mergeTrainWatcherVisible: visible });
  };

  const setListSort = (sort: MergeRequestSort) => {
    setMergeRequestSort(sort);
    saveUIState({ mergeRequestSort: sort });
  };

  const setListGroupBy = (groupBy: MergeRequestGroupBy) => {
    setMergeRequestGroupBy(groupBy);
    saveUIState({ mergeRequestGroupBy: groupBy });
  };

  const primaryActionClassName = 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-100 dark:hover:bg-neutral-700 dark:focus:ring-offset-neutral-900';
  const secondaryActionClassName = 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-200 dark:hover:border-neutral-600 dark:hover:bg-neutral-700 dark:focus:ring-neutral-500 dark:focus:ring-offset-neutral-900';

  const quickFilterItems = useMemo<QuickFilterNavigationItem[]>(() => [
    {
      id: 'preset:my-open-prs',
      label: 'My Open MRs',
      icon: User,
      active: quickFilter === 'my-open-prs',
      disabled: !currentUser,
      activeClassName: 'border-[#e24329]/40 bg-[#e24329]/10 text-[#a92b1b] dark:border-[#e24329]/50 dark:bg-[#e24329]/15 dark:text-[#ff9b85]',
      onActivate: () => onQuickFilterToggle('my-open-prs')
    },
    {
      id: 'preset:not-reviewed-by-me',
      label: 'Not approved by me',
      icon: Eye,
      active: quickFilter === 'not-reviewed-by-me',
      disabled: !currentUser,
      activeClassName: 'border-[#e24329]/40 bg-[#e24329]/10 text-[#a92b1b] dark:border-[#e24329]/50 dark:bg-[#e24329]/15 dark:text-[#ff9b85]',
      onActivate: () => onQuickFilterToggle('not-reviewed-by-me')
    },
    ...customQuickFilters.map((customFilter): QuickFilterNavigationItem => ({
      id: `custom:${customFilter.id}`,
      label: customFilter.name,
      icon: Bookmark,
      active: activeCustomQuickFilterId === customFilter.id,
      activeClassName: 'border-[#e24329]/40 bg-[#e24329]/10 text-[#a92b1b] dark:border-[#e24329]/50 dark:bg-[#e24329]/15 dark:text-[#ff9b85]',
      onActivate: () => onApplyCustomQuickFilter(customFilter),
      onRemove: () => onRemoveCustomQuickFilter(customFilter.id)
    }))
  ], [activeCustomQuickFilterId, currentUser, customQuickFilters, onApplyCustomQuickFilter, onQuickFilterToggle, onRemoveCustomQuickFilter, quickFilter]);

  const orderedQuickFilterItems = useMemo(() => {
    const itemsById = new Map(quickFilterItems.map((item) => [item.id, item]));
    const orderedItems = quickFilterOrder.flatMap((id) => {
      const item = itemsById.get(id);
      if (!item) return [];
      itemsById.delete(id);
      return [item];
    });
    return [...orderedItems, ...itemsById.values()];
  }, [quickFilterItems, quickFilterOrder]);

  const moveQuickFilter = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const orderedIds = orderedQuickFilterItems.map((item) => item.id);
    const sourceIndex = orderedIds.indexOf(sourceId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (sourceIndex === -1 || targetIndex === -1) return;
    orderedIds.splice(sourceIndex, 1);
    orderedIds.splice(targetIndex, 0, sourceId);
    onQuickFilterOrderChange(orderedIds);
  };

  const quickFilterItemClassName = (item: QuickFilterNavigationItem) => `flex min-w-0 shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e24329] ${
    item.active
      ? item.activeClassName
      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700'
  } ${item.disabled ? 'cursor-not-allowed opacity-60' : ''}`;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-neutral-900">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-4 flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-800">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">GitLab MR Viewer</h1>
          <div className="flex flex-wrap items-center gap-2">
            <AutoRefreshControl loading={loading} onRefresh={onRefresh} autoRefreshEnabled={autoRefreshEnabled} onAutoRefreshEnabledChange={onAutoRefreshEnabledChange} className={primaryActionClassName} />
            <button type="button" onClick={onShare} className={secondaryActionClassName}><Link className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />Share URL</button>
            {mergeTrainWatcherVisible && (
              <button type="button" onClick={() => setMobileWatcherOpen((open) => !open)} aria-expanded={mobileWatcherOpen} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 xl:hidden dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-200"><GitBranch className="h-4 w-4 text-amber-600" />Merge trains</button>
            )}
            {!mergeTrainWatcherVisible && (
              <button type="button" onClick={() => setMergeTrainVisibility(true)} className={secondaryActionClassName}><GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400" />Merge Trains</button>
            )}
            <button type="button" onClick={onOpenConnectionSettings} className={secondaryActionClassName}><Settings2 className="h-4 w-4 text-gray-500 dark:text-gray-400" />Connection settings</button>
          </div>
        </div>

        <div className="space-y-5">
          {mergeTrainWatcherVisible && mergeTrainWatcherTrainMode && (
            <aside className={`${mobileWatcherOpen ? '' : 'hidden'} xl:block`}>
              <LegacyMergeTrainWatcher service={service} onHide={() => setMergeTrainVisibility(false)} trainModeEnabled={mergeTrainWatcherTrainMode} onTrainModeChange={setMergeTrainWatcherTrainMode} />
            </aside>
          )}

          {!error && (
            <aside className="relative min-w-0">
              <nav aria-label="Quick filters" className="flex min-w-0 items-center gap-2">
                <h2 className="hidden shrink-0 text-xs font-semibold text-gray-500 sm:block dark:text-gray-400">Quick views</h2>
                <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
                  {orderedQuickFilterItems.map((item) => {
                    const Icon = item.icon;
                    return (
                        <button key={item.id} type="button" onClick={item.onActivate} disabled={item.disabled} aria-pressed={item.active} className={quickFilterItemClassName(item)} title={item.label}>
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        </button>
                    );
                  })}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => setEditingQuickFilters((editing) => !editing)} aria-expanded={editingQuickFilters} aria-controls="manage-quick-views" className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-neutral-700">{editingQuickFilters ? 'Done' : 'Edit'}</button>
                </div>
              </nav>
              {editingQuickFilters && (
                <div id="manage-quick-views" className="absolute right-0 top-full z-30 mt-2 w-[min(24rem,100%)] rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-800" onKeyDown={(event) => { if (event.key === 'Escape') setEditingQuickFilters(false); }}>
                  <div className="mb-2 flex items-center justify-between px-1"><h3 className="text-sm font-semibold text-gray-900 dark:text-white">Manage quick views</h3><button type="button" onClick={() => setEditingQuickFilters(false)} aria-label="Close quick view editor" className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-700"><X className="h-4 w-4" /></button></div>
                  <p className="mb-2 px-1 text-xs text-gray-500 dark:text-gray-400">Drag to reorder or use the arrows.</p>
                  <div className="max-h-80 overflow-y-auto">
                    {orderedQuickFilterItems.map((item, index) => {
                      const Icon = item.icon;
                      return <div key={item.id} draggable onDragStart={(event) => { setDraggedQuickFilterId(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); }} onDragEnd={() => setDraggedQuickFilterId(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); moveQuickFilter(draggedQuickFilterId ?? event.dataTransfer.getData('text/plain'), item.id); setDraggedQuickFilterId(null); }} className={`flex items-center gap-2 border-t border-gray-100 py-1.5 dark:border-neutral-700 ${draggedQuickFilterId === item.id ? 'opacity-50' : ''}`}>
                        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-gray-400 active:cursor-grabbing" aria-hidden="true" /><Icon className="h-4 w-4 shrink-0 text-gray-500" /><span title={item.label} className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">{item.label}</span>
                        <button type="button" onClick={() => index > 0 && moveQuickFilter(item.id, orderedQuickFilterItems[index - 1].id)} disabled={index === 0} aria-label={`Move ${item.label} earlier`} title="Move earlier" className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-25 dark:hover:bg-neutral-700"><ChevronUp className="h-4 w-4" /></button>
                        <button type="button" onClick={() => index < orderedQuickFilterItems.length - 1 && moveQuickFilter(item.id, orderedQuickFilterItems[index + 1].id)} disabled={index === orderedQuickFilterItems.length - 1} aria-label={`Move ${item.label} later`} title="Move later" className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-25 dark:hover:bg-neutral-700"><ChevronDown className="h-4 w-4" /></button>
                        {item.onRemove ? <><button type="button" onClick={() => { const view = customQuickFilters.find((filter) => `custom:${filter.id}` === item.id); if (!view) return; onRestoreCustomQuickFilter(view); setEditingSavedViewId(view.id); setEditSavedViewError(false); setEditingQuickFilters(false); setFiltersExpanded(true); }} aria-label={`Edit filters for ${item.label}`} title="Edit filters" className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-700"><Pencil className="h-4 w-4" /></button><button type="button" onClick={item.onRemove} aria-label={`Delete custom filter ${item.label}`} title="Delete view" className="rounded p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300"><X className="h-4 w-4" /></button></> : <span className="w-14" />}
                      </div>;
                    })}
                  </div>
                </div>
              )}
            </aside>
          )}

          <div className={`grid gap-5 xl:items-start ${mergeTrainWatcherVisible && !mergeTrainWatcherTrainMode ? 'xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]' : ''}`}>
          <main className="min-w-0">
            <div className="relative z-20 mb-6 flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Filter by merge request state or approval" className="inline-flex max-w-full flex-wrap rounded-lg border border-gray-200 bg-white p-1 dark:border-neutral-700 dark:bg-neutral-800">
                {([
                  ['opened', 'Open'],
                  ['needs-approval', 'Needs approval'],
                  ['approved', 'Approved'],
                  ['merged', 'Merged'],
                  ['closed', 'Closed'],
                  ['all', 'All']
                ] as const).map(([state, label]) => {
                  const approvalTab = state === 'approved' || state === 'needs-approval';
                  const hasApprovalTab = filters.approvalState === 'approved' || filters.approvalState === 'needs-approval';
                  const active = approvalTab ? selectedState === 'opened' && filters.approvalState === state : selectedState === state && !(state === 'opened' && hasApprovalTab);
                  return <button key={state} type="button" aria-pressed={active} onClick={() => onFiltersChange(approvalTab ? { ...filters, state: 'opened', approvalState: state } : { ...filters, state, approvalState: hasApprovalTab ? undefined : filters.approvalState })} className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#e24329] ${active ? 'bg-[#e24329]/10 text-[#a92b1b] dark:bg-[#e24329]/15 dark:text-[#ff9b85]' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-neutral-700'}`}>
                    {label}
                  </button>;
                })}
              </div>
              <LegacyFilterPanel filters={filters} onFiltersChange={onFiltersChange} isExpanded={filtersExpanded} onToggle={toggleFilters} service={service} canSaveQuickFilter={canSaveCustomQuickFilters} onSaveQuickFilter={onSaveCustomQuickFilter} editingViewName={customQuickFilters.find((view) => view.id === editingSavedViewId)?.name} editError={editSavedViewError} onSaveEditedView={() => { if (!editingSavedViewId) return; if (!onUpdateCustomQuickFilter(editingSavedViewId)) { setEditSavedViewError(true); return; } setEditingSavedViewId(null); setEditSavedViewError(false); setFiltersExpanded(false); saveUIState({ filtersExpanded: false }); }} />
            </div>

            {selectedState !== 'opened' && (filters.approvalState || filters.notReviewedByMe) && (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="status">
                Review status filters only match open MRs. Choose Open or clear the review filters.
              </p>
            )}

            {selectedState !== 'merged' && filters.mergedAfter && (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="status">
                Merged After only matches merged MRs. Choose Merged or clear this date.
              </p>
            )}

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
              <div>
              <div className="mb-4 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap sm:gap-3">
                <div className="relative col-span-2 min-w-0 sm:flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    value={mergeRequestSearch}
                    onChange={(event) => setMergeRequestSearch(event.target.value)}
                    placeholder="Search titles, people, branches, labels…"
                    aria-label="Search loaded merge requests"
                    className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-10 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 hover:border-gray-300 focus:border-[#e24329] focus:ring-2 focus:ring-[#e24329]/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-gray-500 dark:hover:border-neutral-600 dark:focus:border-[#e24329] dark:focus:ring-[#e24329]/30"
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
                <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-500 sm:flex-row sm:items-center sm:gap-2 sm:text-sm dark:text-gray-400">Sort
                  <select aria-label="Sort merge requests" value={mergeRequestSort} onChange={(event) => setListSort(event.target.value as MergeRequestSort)} className="w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-800 sm:w-auto sm:px-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100">
                    <option value="updated-desc">Recently updated</option><option value="updated-asc">Oldest updated</option><option value="comments-desc">Most discussed</option><option value="size-desc">Largest changes</option>
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-500 sm:flex-row sm:items-center sm:gap-2 sm:text-sm dark:text-gray-400">Group
                  <select aria-label="Group merge requests" value={mergeRequestGroupBy} onChange={(event) => setListGroupBy(event.target.value as MergeRequestGroupBy)} className="w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-800 sm:w-auto sm:px-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100">
                    <option value="none">No grouping</option><option value="project">Project</option><option value="author">Author</option><option value="review">Review status</option>
                  </select>
                </label>
              </div>

            {!loading && (
              <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                <span>
                Showing {isMergeRequestSearchActive ? visibleMergeRequests.length : mergeRequests.length} loaded merge request{(isMergeRequestSearchActive ? visibleMergeRequests.length : mergeRequests.length) === 1 ? '' : 's'}{isMergeRequestSearchActive && ` matching "${deferredMergeRequestSearch.trim()}"`} {filteredProjects.length === 1 ? <>in <strong>{filteredProjects[0]}</strong></> : filteredProjects.length > 1 ? <>across <strong>{filteredProjects.length} selected projects</strong></> : 'across your GitLab projects'}{hasMore ? '; more are available' : ''}.
                </span>
                {resultSummary.needsApproval > 0 && <span className="text-rose-700 dark:text-rose-300">{resultSummary.needsApproval} need approval</span>}
                {resultSummary.drafts > 0 && <span>{resultSummary.drafts} drafts</span>}
                {resultSummary.failedPipelines > 0 && <span className="text-red-700 dark:text-red-300">{resultSummary.failedPipelines} failed pipelines</span>}
                <button type="button" disabled={!visibleMergeRequests.length} onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(sortedMergeRequests.map((mr) => `${mr.title} - ${mr.web_url}`).join('\n'));
                    setCopyNotice('Copied');
                  } catch {
                    setCopyNotice('Copy failed');
                  }
                }} className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700"><Copy className="h-3.5 w-3.5" />Copy list</button>
                <span role="status" className="text-xs">{copyNotice}</span>
              </div>
            )}

            <MergeRequestList
              mergeRequests={sortedMergeRequests}
              groupBy={mergeRequestGroupBy}
              loading={loading}
              showProjectInfo={filteredProjects.length !== 1}
              loadingMessage={filteredProjects.length === 0 ? 'Loading merge requests across your projects...' : filteredProjects.length > 1 ? `Loading merge requests from ${filteredProjects.length} selected projects...` : undefined}
              emptyMessage={isMergeRequestSearchActive ? 'No merge requests match your search' : undefined}
              emptyDescription={isMergeRequestSearchActive ? 'Try a different search term or clear the search to see all loaded merge requests.' : undefined}
              onStartSemanticReview={onStartSemanticReview}
            />

            {!loading && hasMore && (
              <div className="mt-6 flex justify-center">
                <button type="button" onClick={onLoadMore} disabled={loadingMore} className={secondaryActionClassName}>
                  {loadingMore ? 'Loading more…' : 'Load more merge requests'}
                </button>
              </div>
            )}
                </div>
            )}
          </main>

          {mergeTrainWatcherVisible && !mergeTrainWatcherTrainMode && (
            <aside className={`order-first ${mobileWatcherOpen ? '' : 'hidden'} xl:order-none xl:sticky xl:top-4 xl:block`}>
              <LegacyMergeTrainWatcher service={service} onHide={() => setMergeTrainVisibility(false)} trainModeEnabled={mergeTrainWatcherTrainMode} onTrainModeChange={setMergeTrainWatcherTrainMode} />
            </aside>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
