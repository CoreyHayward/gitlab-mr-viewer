'use client';

import { useEffect, useState } from 'react';
import { FilterOptions } from '@/types/gitlab';
import { GitLabService } from '@/services/gitlab';
import LegacyUserMultiSelect from './LegacyUserMultiSelect';
import { MAX_SHARED_LIST_VALUE_LENGTH, MAX_SHARED_LIST_VALUES, MAX_SHARED_TEXT_LENGTH } from '@/utils/urlState';
import { MAX_CUSTOM_QUICK_FILTER_NAME_LENGTH } from '@/utils/customQuickFilters';
import { Filter, ChevronDown, Search, Ban, Layers, Trash2, Check, X } from 'lucide-react';

const parseProjects = (value: string) => Array.from(new Set(value
  .split(',')
  .map((project) => project.trim().slice(0, MAX_SHARED_LIST_VALUE_LENGTH))
  .filter(Boolean)))
  .slice(0, MAX_SHARED_LIST_VALUES);

interface FilterPanelProps {
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  isExpanded: boolean;
  onToggle: () => void;
  service: GitLabService;
  canSaveQuickFilter: boolean;
  onSaveQuickFilter: (name: string) => boolean;
  editingViewName?: string;
  editError?: boolean;
  onSaveEditedView?: () => void;
}

export default function LegacyFilterPanel({ filters, onFiltersChange, isExpanded, onToggle, service, canSaveQuickFilter, onSaveQuickFilter, editingViewName, editError, onSaveEditedView }: FilterPanelProps) {
  const [localFilters, setLocalFilters] = useState<FilterOptions>(filters);
  const [projectInput, setProjectInput] = useState(filters.projects?.join(', ') ?? '');
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    if (!isExpanded) { setSavingView(false); setViewName(''); setSaveMessage(''); }
  }, [isExpanded]);

  useEffect(() => {
    setLocalFilters(filters);
    setProjectInput((current) => JSON.stringify(parseProjects(current)) === JSON.stringify(filters.projects ?? [])
      ? current
      : filters.projects?.join(', ') ?? '');
  }, [filters]);

  useEffect(() => {
    if (!isExpanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggle();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded, onToggle]);

  const handleFilterChange = (key: keyof FilterOptions, value: string | string[] | boolean | undefined) => {
    const newFilters = { ...localFilters, [key]: value };
    setLocalFilters(newFilters);
    onFiltersChange(newFilters);
  };

  const handleProjectsChange = (value: string) => {
    setProjectInput(value);
    const projects = parseProjects(value);
    handleFilterChange('projects', projects.length > 0 ? projects : undefined);
  };

  const clearFilters = () => {
    const emptyFilters: FilterOptions = { state: localFilters.state ?? 'opened' };
    setLocalFilters(emptyFilters);
    setProjectInput('');
    onFiltersChange(emptyFilters);
  };

  // State has its own control beside this panel.
  const activeFiltersCount = Object.entries(localFilters).filter(([key, value]) => {
    if (key === 'state') return false;
    if (key === 'notReviewedByMe' && value !== true) return false;
    return value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0);
  }).length;

  return (
    <div className="relative">
      <button type="button" onClick={onToggle} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e24329] dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 dark:hover:bg-neutral-700" aria-expanded={isExpanded} aria-controls="advanced-filter-panel">
        <Filter className="h-4 w-4 text-[#e24329]" />
        <span>Advanced filters</span>
        {activeFiltersCount > 0 && <span className="rounded-full bg-[#e24329]/10 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-[#a92b1b] dark:bg-[#e24329]/15 dark:text-[#ff9b85]">{activeFiltersCount}</span>}
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      {isExpanded && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6">
          <button type="button" onClick={onToggle} aria-label="Close advanced filters" className="absolute inset-0 cursor-default bg-black/40" tabIndex={-1} />
          <div id="advanced-filter-panel" role="dialog" aria-label="Advanced filters" className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)] dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex shrink-0 items-start justify-between border-b border-gray-200 px-5 py-3 dark:border-neutral-700">
            <div><h3 className="text-base font-semibold text-gray-900 dark:text-white">{editingViewName ? `Edit ${editingViewName}` : 'Advanced filters'}</h3><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{editingViewName ? 'Change the filters, then save this quick view.' : 'Changes apply as you edit.'}</p></div>
            <button type="button" onClick={onToggle} aria-label="Close advanced filters" className="rounded-md p-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 dark:hover:bg-neutral-800"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                People and approval
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="merge-request-approval-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Approval status</label>
                  <div className="relative">
                    <select
                      id="merge-request-approval-filter"
                      value={localFilters.approvalState || ''}
                      onChange={(event) => handleFilterChange('approvalState', event.target.value || undefined)}
                      className="w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm transition-colors hover:border-gray-400 focus:border-[#e24329] focus:outline-none focus:ring-2 focus:ring-[#e24329]/15 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white dark:hover:border-neutral-500"
                    >
                      <option value="">Any approval status</option>
                      <option value="needs-approval">Needs approval</option>
                      <option value="needs-review">No approvals yet</option>
                      <option value="partially-approved">Partially approved</option>
                      <option value="approved">Approved</option>
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Approval status only matches open merge requests.</p>
                </div>

                <div className="space-y-2">
                  <LegacyUserMultiSelect
                    service={service}
                    selectedUsers={localFilters.authors || []}
                    onUsersChange={(usernames) => handleFilterChange('authors', usernames.length > 0 ? usernames : undefined)}
                    placeholder="Search and select authors..."
                    label="Authors"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                Title and projects
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

                <div className="space-y-2">
                  <label htmlFor="merge-request-title-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Title includes
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="w-4 h-4 text-gray-400" />
                    </div>
                    <input
                      id="merge-request-title-filter"
                      type="text"
                      maxLength={MAX_SHARED_TEXT_LENGTH}
                      value={localFilters.title || ''}
                      onChange={(e) => handleFilterChange('title', e.target.value || undefined)}
                      placeholder="Search merge request titles..."
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-white dark:bg-neutral-700 border border-gray-300 dark:border-neutral-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e24329]/20 focus:border-[#e24329] dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-all duration-200 hover:border-gray-400 dark:hover:border-neutral-500"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="merge-request-exclude-title-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Title excludes
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Ban className="w-4 h-4 text-gray-400" />
                    </div>
                    <input
                      id="merge-request-exclude-title-filter"
                      type="text"
                      maxLength={MAX_SHARED_TEXT_LENGTH}
                      value={localFilters.excludeTitle || ''}
                      onChange={(e) => handleFilterChange('excludeTitle', e.target.value || undefined)}
                      placeholder="Exclude titles containing..."
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-white dark:bg-neutral-700 border border-gray-300 dark:border-neutral-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e24329]/20 focus:border-[#e24329] dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-all duration-200 hover:border-gray-400 dark:hover:border-neutral-500"
                    />
                  </div>
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label htmlFor="merge-request-project-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Project names or paths
                    <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">(exact name or path; up to {MAX_SHARED_LIST_VALUES})</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Layers className="w-4 h-4 text-gray-400" />
                    </div>
                    <input
                      id="merge-request-project-filter"
                      type="text"
                      maxLength={(MAX_SHARED_LIST_VALUE_LENGTH + 2) * MAX_SHARED_LIST_VALUES}
                      value={projectInput}
                      onChange={(e) => handleProjectsChange(e.target.value)}
                      placeholder="project1, group/project2, ..."
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-white dark:bg-neutral-700 border border-gray-300 dark:border-neutral-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e24329]/20 focus:border-[#e24329] dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-all duration-200 hover:border-gray-400 dark:hover:border-neutral-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                Dates
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">

                <div className="space-y-2">
                  <label htmlFor="merge-request-created-after-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Created After
                  </label>
                  <div className="relative">
                    <input
                      id="merge-request-created-after-filter"
                      type="date"
                      value={localFilters.dateFrom || ''}
                      onChange={(e) => handleFilterChange('dateFrom', e.target.value || undefined)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-[#e24329] focus:outline-none focus:ring-2 focus:ring-[#e24329]/20 dark:border-neutral-600 dark:bg-neutral-800 dark:text-white"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="merge-request-created-before-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Created Before
                  </label>
                  <div className="relative">
                    <input
                      id="merge-request-created-before-filter"
                      type="date"
                      value={localFilters.dateTo || ''}
                      onChange={(e) => handleFilterChange('dateTo', e.target.value || undefined)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-[#e24329] focus:outline-none focus:ring-2 focus:ring-[#e24329]/20 dark:border-neutral-600 dark:bg-neutral-800 dark:text-white"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="merge-request-merged-after-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Merged After
                  </label>
                  <div className="relative">
                    <input
                      id="merge-request-merged-after-filter"
                      type="date"
                      value={localFilters.mergedAfter ? localFilters.mergedAfter.slice(0, 10) : ''}
                      onChange={(event) => handleFilterChange('mergedAfter', event.target.value ? new Date(`${event.target.value}T00:00:00.000Z`).toISOString() : undefined)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm transition-colors hover:border-gray-400 focus:border-[#e24329] focus:outline-none focus:ring-2 focus:ring-[#e24329]/20 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white dark:hover:border-neutral-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                More options
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="contents">
                    <label className="group flex cursor-pointer items-center space-x-3">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={localFilters.draft === true}
                          onChange={(event) => handleFilterChange('draft', event.target.checked ? true : undefined)}
                          className="sr-only"
                        />
                        <div className={`h-5 w-5 rounded border-2 transition-all duration-200 ${
                          localFilters.draft === true
                            ? 'border-[#e24329] bg-[#e24329]'
                            : 'border-gray-300 dark:border-neutral-600 group-hover:border-[#e24329]'
                        }`}>
                          {localFilters.draft === true && (
                            <Check className="absolute left-0.5 top-0.5 h-3 w-3 text-white" />
                          )}
                        </div>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-gray-700 transition-colors group-hover:text-gray-900 dark:text-gray-300 dark:group-hover:text-white">
                          Drafts only
                        </span>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Show only merge requests marked as drafts
                        </p>
                      </div>
                    </label>
                    <label className="group flex cursor-pointer items-center space-x-3">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={localFilters.notReviewedByMe === true}
                          onChange={(event) => handleFilterChange('notReviewedByMe', event.target.checked ? true : undefined)}
                          className="sr-only"
                        />
                        <div className={`h-5 w-5 rounded border-2 transition-all duration-200 ${
                          localFilters.notReviewedByMe === true
                            ? 'border-[#e24329] bg-[#e24329]'
                            : 'border-gray-300 dark:border-neutral-600 group-hover:border-[#e24329]'
                        }`}>
                          {localFilters.notReviewedByMe === true && (
                            <Check className="absolute left-0.5 top-0.5 h-3 w-3 text-white" />
                          )}
                        </div>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-gray-700 transition-colors group-hover:text-gray-900 dark:text-gray-300 dark:group-hover:text-white">
                          Not approved by me
                        </span>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Hide merge requests you have already approved
                        </p>
                      </div>
                    </label>
                </div>

              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 px-5 py-2 dark:border-neutral-700">
            <button type="button" onClick={clearFilters} disabled={activeFiltersCount === 0} className="inline-flex items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-neutral-800"><Trash2 className="h-4 w-4" />Clear filters</button>
            <div className="flex items-center gap-2">{editingViewName ? <><button type="button" onClick={onToggle} className="rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-neutral-800">Cancel</button><button type="button" onClick={onSaveEditedView} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">Save changes</button></> : <><button type="button" disabled={!canSaveQuickFilter} onClick={() => { setSavingView(true); setSaveMessage(''); }} className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-neutral-800">Save as quick view</button><button type="button" onClick={onToggle} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">Done</button></>}</div>
          </div>
          {editError && <p role="alert" className="px-5 pb-3 text-xs text-red-700 dark:text-red-300">Could not save this view in browser storage.</p>}
          {(savingView || saveMessage) && <div className="border-t border-gray-200 px-5 py-3 dark:border-neutral-700">
            {savingView && <form onSubmit={(event) => { event.preventDefault(); const name = viewName.trim(); if (!name) { setSaveMessage('Enter a name for this view.'); return; } if (!onSaveQuickFilter(name)) { setSaveMessage('Could not save this view in browser storage.'); return; } setSavingView(false); setViewName(''); setSaveMessage('Saved to Quick views.'); }} className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">Quick view name<input autoFocus value={viewName} onChange={(event) => { setViewName(event.target.value); setSaveMessage(''); }} maxLength={MAX_CUSTOM_QUICK_FILTER_NAME_LENGTH} placeholder="e.g. Team reviews" className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-2 focus:outline-[#e24329] dark:border-neutral-600 dark:bg-neutral-800 dark:text-white" /></label>
              <button type="submit" className="rounded-md bg-gray-800 px-3 py-2 text-sm font-medium text-white dark:bg-gray-200 dark:text-gray-900">Save</button><button type="button" onClick={() => { setSavingView(false); setSaveMessage(''); }} className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-neutral-800">Cancel</button>
            </form>}
            {saveMessage && <p role="status" className="mt-1 text-xs text-gray-600 dark:text-gray-300">{saveMessage}</p>}
          </div>}
          </div>
        </div>
      )}
    </div>
  );
}
