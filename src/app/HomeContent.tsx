'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Filter, GitBranch, Inbox, Link, LogOut, RefreshCcw, User, Users, X } from 'lucide-react';
import ConfigForm from '@/components/ConfigForm';
import FilterPanel from '@/components/FilterPanel';
import MergeDesk, { DeskView } from '@/components/MergeDesk';
import MergeTrainWatcher from '@/components/MergeTrainWatcher';
import ProjectSelector from '@/components/ProjectSelector';
import { GitLabService } from '@/services/gitlab';
import { FilterOptions, GitLabMergeRequest, GitLabProject, GitLabUser } from '@/types/gitlab';
import { decodeFiltersFromURL, updateURL } from '@/utils/urlState';

export default function HomeContent() {
  const [service, setService] = useState<GitLabService | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<GitLabProject[]>([]);
  const [mergeRequests, setMergeRequests] = useState<GitLabMergeRequest[]>([]);
  const [filters, setFilters] = useState<FilterOptions>({ state: 'opened' });
  const [currentUser, setCurrentUser] = useState<GitLabUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deskView, setDeskView] = useState<DeskView>('inbox');
  const [isExploreOpen, setIsExploreOpen] = useState(false);
  const [isMergeLaneOpen, setIsMergeLaneOpen] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [initialProjectIds, setInitialProjectIds] = useState<number[] | null>(null);

  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const { filters: urlFilters, projectIds } = decodeFiltersFromURL(new URLSearchParams(window.location.search));
    setFilters(urlFilters);
    setInitialProjectIds(projectIds ?? []);
  }, []);

  useEffect(() => {
    if (!service) {
      setCurrentUser(null);
      return;
    }

    let active = true;
    void service.getCurrentUser()
      .then((user) => {
        if (active) setCurrentUser(user);
      })
      .catch(() => {
        if (active) setCurrentUser(null);
      });

    return () => {
      active = false;
    };
  }, [service]);

  useEffect(() => {
    if (!service || initialProjectIds === null || initialProjectIds.length === 0) return;

    let active = true;
    void Promise.all(initialProjectIds.map((projectId) => service.getProject(projectId).catch(() => null)))
      .then((projects) => {
        if (!active) return;
        setSelectedProjects(projects.filter((project): project is GitLabProject => project !== null));
        setInitialProjectIds([]);
      });

    return () => {
      active = false;
    };
  }, [service, initialProjectIds]);

  const loadMergeRequests = useCallback(async () => {
    if (!service || initialProjectIds === null || initialProjectIds.length > 0) return;

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const results = selectedProjects.length === 0
        ? await service.getAllMergeRequests(filters, controller.signal)
        : selectedProjects.length === 1
          ? await service.getMergeRequests(selectedProjects[0].id, filters, controller.signal)
          : await service.getMergeRequestsForProjects(selectedProjects.map((project) => project.id), filters, controller.signal);

      if (controller.signal.aborted) return;
      const [approvals, diffStats] = await Promise.allSettled([
        service.enrichMergeRequestsWithApprovalStatus(results, controller.signal),
        service.enrichMergeRequestsWithDiffStats(results, controller.signal)
      ]);
      if (controller.signal.aborted) return;

      const approvalsById = approvals.status === 'fulfilled'
        ? new Map(approvals.value.map((mergeRequest) => [mergeRequest.id, mergeRequest.approval_status]))
        : new Map<number, GitLabMergeRequest['approval_status']>();
      const diffStatsById = diffStats.status === 'fulfilled'
        ? new Map(diffStats.value.map((mergeRequest) => [mergeRequest.id, mergeRequest.diff_stats]))
        : new Map<number, GitLabMergeRequest['diff_stats']>();

      setMergeRequests(results.map((mergeRequest) => ({
        ...mergeRequest,
        approval_status: approvalsById.get(mergeRequest.id) ?? mergeRequest.approval_status,
        diff_stats: diffStatsById.get(mergeRequest.id) ?? mergeRequest.diff_stats
      })));
    } catch (loadError) {
      if (loadError instanceof Error && loadError.message === 'Request cancelled') return;
      if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load merge requests');
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [filters, initialProjectIds, selectedProjects, service]);

  useEffect(() => {
    void loadMergeRequests();
  }, [loadMergeRequests]);

  useEffect(() => {
    if (!service || initialProjectIds === null) return;
    updateURL(filters, selectedProjects.map((project) => project.id));
  }, [filters, initialProjectIds, selectedProjects, service]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const handleProjectsChange = (projects: GitLabProject[]) => {
    setSelectedProjects(projects);
    setInitialProjectIds([]);
  };

  const handleFiltersChange = (nextFilters: FilterOptions) => {
    setFilters(nextFilters);
  };

  const handleRefresh = () => {
    service?.clearApprovalCache();
    service?.clearDiffStatsCache();
    void loadMergeRequests();
  };

  const handleShareURL = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      window.alert('View URL copied to clipboard.');
    } catch {
      window.prompt('Copy this view URL:', window.location.href);
    }
  };

  const handleDisconnect = () => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setService(null);
    setSelectedProjects([]);
    setMergeRequests([]);
    setCurrentUser(null);
    setError(null);
    setFilters({ state: 'opened' });
    setInitialProjectIds([]);
    localStorage.removeItem('gitlab-instance-url');
    localStorage.removeItem('gitlab-token');
    window.history.replaceState({}, '', window.location.pathname);
  };

  const scopeLabel = selectedProjects.length === 0
    ? 'All accessible projects'
    : selectedProjects.length === 1
      ? selectedProjects[0].path_with_namespace
      : `${selectedProjects.length} selected projects`;

  const navigationButtonClass = (active: boolean) => `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
    active
      ? 'bg-indigo-600 text-white shadow-sm'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/[0.07] dark:hover:text-white'
  }`;

  if (!service) {
    return (
      <div className="min-h-screen bg-[#f7f7f5] text-slate-950 dark:bg-[#10131b] dark:text-white">
        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-slate-800 dark:text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-xs font-bold text-white">M</span>
            Merge Desk
          </div>
          <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start">
            <div className="max-w-xl pt-4">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">Your private GitLab workspace</p>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl dark:text-white">Make the next merge-request decision obvious.</h1>
              <p className="mt-6 text-lg leading-8 text-slate-600 dark:text-slate-300">Merge Desk prioritises reviews, blockers, and merge-ready changes across the projects you choose. GitLab remains the place where you review and merge.</p>
              <div className="mt-8 grid gap-3 text-sm text-slate-600 sm:grid-cols-2 dark:text-slate-300">
                <div className="rounded-lg border border-slate-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]">Review work, pipeline health, approval progress, and merge trains in one focused queue.</div>
                <div className="rounded-lg border border-slate-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]">Your token and GitLab data stay in your browser. Nothing is sent to an app server.</div>
              </div>
            </div>
            <ConfigForm onConfigured={setService} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-slate-950 dark:bg-[#10131b] dark:text-white">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-[#f7f7f5]/90 backdrop-blur dark:border-white/10 dark:bg-[#10131b]/90">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white">M</div>
            <span className="hidden text-sm font-semibold tracking-tight sm:block">Merge Desk</span>
            <ProjectSelector service={service} selectedProjects={selectedProjects} onProjectsChange={handleProjectsChange} />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setFiltersExpanded(true);
                setIsExploreOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/[0.07] dark:hover:text-white"
            >
              <Filter className="h-4 w-4" /><span className="hidden sm:inline">Explore</span>
            </button>
            <button type="button" onClick={handleShareURL} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/[0.07] dark:hover:text-white" title="Copy this view's URL">
              <Link className="h-4 w-4" /><span className="hidden sm:inline">Share</span>
            </button>
            <button type="button" onClick={handleRefresh} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:text-slate-950 dark:hover:bg-indigo-400">
              <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[12.5rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)]">
          <nav className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:block" aria-label="Merge Desk views">
            <button type="button" onClick={() => { setDeskView('inbox'); setIsMergeLaneOpen(false); }} className={navigationButtonClass(!isMergeLaneOpen && deskView === 'inbox')}><Inbox className="h-4 w-4" />Inbox</button>
            <button type="button" onClick={() => { setDeskView('my-work'); setIsMergeLaneOpen(false); }} className={navigationButtonClass(!isMergeLaneOpen && deskView === 'my-work')}><User className="h-4 w-4" />My work</button>
            <button type="button" onClick={() => { setDeskView('team-pulse'); setIsMergeLaneOpen(false); }} className={navigationButtonClass(!isMergeLaneOpen && deskView === 'team-pulse')}><Users className="h-4 w-4" />Team pulse</button>
            <button type="button" onClick={() => setIsMergeLaneOpen(true)} className={navigationButtonClass(isMergeLaneOpen)}><GitBranch className="h-4 w-4" />Merge lane</button>
          </nav>

          <div className="mt-6 hidden border-t border-slate-200 pt-5 lg:block dark:border-white/10">
            <p className="px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Scope</p>
            <p className="mt-2 px-3 text-sm leading-5 text-slate-600 dark:text-slate-300">{scopeLabel}</p>
            <p className="mt-1 px-3 text-xs text-slate-400">{mergeRequests.length} loaded merge request{mergeRequests.length === 1 ? '' : 's'}</p>
          </div>

          <button type="button" onClick={handleDisconnect} className="mt-6 hidden w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 lg:flex dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white"><LogOut className="h-4 w-4" />Disconnect</button>
        </aside>

        <main className="min-w-0">
          {error && (
            <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/80 dark:bg-rose-950/30 dark:text-rose-200">
              <div className="whitespace-pre-line">{error}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={handleRefresh} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-800 dark:bg-rose-400 dark:text-rose-950 dark:hover:bg-rose-300">Try again</button>
                <button type="button" onClick={() => { setFiltersExpanded(true); setIsExploreOpen(true); }} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-800 transition-colors hover:bg-rose-100 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-900/40">Narrow scope or filters</button>
              </div>
            </div>
          )}

          {isMergeLaneOpen ? (
            <div className="max-w-4xl">
              <div className="mb-6">
                <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Operations</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">Merge lane</h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Watch active merge trains without competing with the review queue.</p>
              </div>
              <MergeTrainWatcher service={service} onHide={() => setIsMergeLaneOpen(false)} />
            </div>
          ) : (
            <MergeDesk mergeRequests={mergeRequests} loading={loading} currentUser={currentUser} view={deskView} scopeLabel={scopeLabel} />
          )}
        </main>
      </div>

      {isExploreOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/35 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Explore merge requests">
          <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-[#f7f7f5] shadow-2xl dark:border-white/10 dark:bg-[#10131b]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-white/10">
              <div><h2 className="text-lg font-semibold text-slate-950 dark:text-white">Explore merge requests</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Build a precise view, then copy its URL to share it.</p></div>
              <button type="button" onClick={() => setIsExploreOpen(false)} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.07] dark:hover:text-white" aria-label="Close explore"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <FilterPanel filters={filters} onFiltersChange={handleFiltersChange} isExpanded={filtersExpanded} onToggle={() => setFiltersExpanded((expanded) => !expanded)} service={service} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
