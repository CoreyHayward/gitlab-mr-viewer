'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConnectionSettingsModal from '@/components/ConnectionSettingsModal';
import ConfigForm from '@/components/ConfigForm';
import SemanticReviewWorkspace from '@/components/SemanticReviewWorkspace';
import LegacyWorkspace, { LegacyQuickFilter } from '@/components/legacy/LegacyWorkspace';
import { clearAiProviderConfig, writeAiProviderConfig } from '@/review/storage';
import type { AiProviderConfig } from '@/review/types';
import { GitLabService } from '@/services/gitlab';
import { FilterOptions, GitLabMergeRequest, GitLabProject, GitLabUser } from '@/types/gitlab';
import {
  clearGuidedReviewURL,
  decodeFiltersFromURL,
  decodeGuidedReviewFromURL,
  isGuidedReviewHistoryEntry,
  pushGuidedReviewURL,
  updateURL,
  type GuidedReviewLocation
} from '@/utils/urlState';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useMergeRequestResults } from '@/hooks/useMergeRequestResults';

const AUTO_REFRESH_INTERVAL_MS = 60_000;
const AUTO_REFRESH_ENABLED_KEY = 'gitlab-mr-viewer-auto-refresh-enabled';

const getSevenDaysAgoISOString = () => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return sevenDaysAgo.toISOString();
};

const applyQuickFilter = (
  filters: FilterOptions,
  quickFilter: LegacyQuickFilter | null,
  currentUser: GitLabUser | null
): FilterOptions => {
  switch (quickFilter) {
    case 'my-open-prs':
      return currentUser ? { ...filters, state: 'opened', authors: [currentUser.username] } : filters;
    case 'needs-approval':
      return { ...filters, approvalState: 'needs-approval' };
    case 'not-reviewed-by-me':
      return { ...filters, notReviewedByMe: true };
    case 'recently-merged-prs':
      return { ...filters, state: 'merged', mergedAfter: getSevenDaysAgoISOString() };
    default:
      return filters;
  }
};

export default function HomeContent() {
  const [service, setService] = useState<GitLabService | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<GitLabProject[]>([]);
  const [filters, setFilters] = useState<FilterOptions>({ state: 'opened' });
  const [currentUser, setCurrentUser] = useState<GitLabUser | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [projectResolutionWarnings, setProjectResolutionWarnings] = useState<string[]>([]);
  const [initialProjectIds, setInitialProjectIds] = useState<number[] | null>(null);
  const [quickFilter, setQuickFilter] = useState<LegacyQuickFilter | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [isHoveringMergeRequest, setIsHoveringMergeRequest] = useState(false);
  const [aiConfig, setAiConfig] = useState<AiProviderConfig | null>(null);
  const [isConnectionSettingsOpen, setIsConnectionSettingsOpen] = useState(false);
  const [reviewingMergeRequest, setReviewingMergeRequest] = useState<GitLabMergeRequest | null>(null);
  const [guidedReviewLocation, setGuidedReviewLocation] = useState<GuidedReviewLocation | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  const reviewLookupControllerRef = useRef<AbortController | null>(null);
  const reviewLookupKeyRef = useRef<string | null>(null);
  const debouncedFilters = useDebouncedValue(filters, 300);
  const effectiveFilters = useMemo(
    () => applyQuickFilter(debouncedFilters, quickFilter, currentUser),
    [currentUser, debouncedFilters, quickFilter]
  );
  const {
    mergeRequests,
    loading,
    loadingMore,
    error: loadError,
    warnings: loadWarnings,
    hasMore,
    load: loadMergeRequests,
    reset: resetMergeRequestResults
  } = useMergeRequestResults({
    service,
    selectedProjects,
    filters: effectiveFilters,
    enabled: initialProjectIds !== null && initialProjectIds.length === 0
  });

  const applyURLState = useCallback(() => {
    const { filters: urlFilters, projectIds, guidedReview } = decodeFiltersFromURL(new URLSearchParams(window.location.search));
    setFilters(urlFilters);
    setQuickFilter(null);
    setInitialProjectIds(projectIds ?? []);
    if (!projectIds || projectIds.length === 0) setSelectedProjects([]);
    setGuidedReviewLocation(guidedReview);
    setReviewingMergeRequest(null);
    setProjectResolutionWarnings([]);
    setNavigationError(null);
  }, []);

  useEffect(() => {
    applyURLState();
    setAutoRefreshEnabled(localStorage.getItem(AUTO_REFRESH_ENABLED_KEY) === 'true');

    window.addEventListener('popstate', applyURLState);
    return () => window.removeEventListener('popstate', applyURLState);
  }, [applyURLState]);

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
    void Promise.all(initialProjectIds.map(async (projectId) => {
      try {
        return { projectId, project: await service.getProject(projectId), error: null };
      } catch (error) {
        return { projectId, project: null, error };
      }
    }))
      .then((results) => {
        if (!active) return;
        setSelectedProjects(results.map(({ project }) => project).filter((project): project is GitLabProject => project !== null));
        setProjectResolutionWarnings(results.flatMap(({ projectId, error }) => error
          ? [`Project ${projectId} from the shared URL could not be loaded: ${error instanceof Error ? error.message : 'Unknown error'}`]
          : []));
        setInitialProjectIds([]);
      });

    return () => {
      active = false;
    };
  }, [service, initialProjectIds]);

  useEffect(() => {
    if (!service || !guidedReviewLocation) {
      reviewLookupControllerRef.current?.abort();
      reviewLookupControllerRef.current = null;
      reviewLookupKeyRef.current = null;
      setReviewingMergeRequest(null);
      return;
    }
    setNavigationError(null);

    const lookupKey = `${service.getInstanceUrl()}:${guidedReviewLocation.projectId}:${guidedReviewLocation.iid}`;
    const mergeRequest = mergeRequests.find((candidate) => (
      candidate.project_id === guidedReviewLocation.projectId && candidate.iid === guidedReviewLocation.iid
    ));

    if (mergeRequest) {
      reviewLookupControllerRef.current?.abort();
      reviewLookupControllerRef.current = null;
      reviewLookupKeyRef.current = lookupKey;
      setReviewingMergeRequest(mergeRequest);
      return;
    }

    if (reviewLookupKeyRef.current === lookupKey) return;

    reviewLookupControllerRef.current?.abort();
    const controller = new AbortController();
    reviewLookupControllerRef.current = controller;
    reviewLookupKeyRef.current = lookupKey;
    let active = true;

    void service.getMergeRequest(guidedReviewLocation.projectId, guidedReviewLocation.iid, controller.signal)
      .then((loadedMergeRequest) => {
        if (active && !controller.signal.aborted) setReviewingMergeRequest(loadedMergeRequest);
      })
      .catch((loadError) => {
        if (!active || controller.signal.aborted) return;
        if (reviewLookupControllerRef.current === controller) reviewLookupKeyRef.current = null;
        setNavigationError(loadError instanceof Error ? loadError.message : 'Unable to open this merge request for guided review.');
      })
      .finally(() => {
        if (reviewLookupControllerRef.current === controller) reviewLookupControllerRef.current = null;
      });

    return () => {
      active = false;
      if (reviewLookupControllerRef.current === controller) {
        controller.abort();
        reviewLookupControllerRef.current = null;
        reviewLookupKeyRef.current = null;
      }
    };
  }, [guidedReviewLocation, mergeRequests, service]);

  useEffect(() => {
    if (!service || initialProjectIds === null || initialProjectIds.length > 0 || loading || !autoRefreshEnabled || isHoveringMergeRequest) return;

    const refreshWhenVisible = () => {
      if (document.hidden) return;
      service.clearApprovalCache();
      service.clearDiffStatsCache();
      void loadMergeRequests();
    };

    const intervalId = window.setInterval(refreshWhenVisible, AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [autoRefreshEnabled, initialProjectIds, isHoveringMergeRequest, loadMergeRequests, loading, service]);

  useEffect(() => {
    const isMergeRequestTarget = (target: EventTarget | null) => (
      target instanceof Element && Boolean(target.closest('[data-merge-request]'))
    );
    const handlePointerOver = (event: PointerEvent) => setIsHoveringMergeRequest(isMergeRequestTarget(event.target));
    const handlePointerOut = (event: PointerEvent) => {
      if (isMergeRequestTarget(event.target) && !isMergeRequestTarget(event.relatedTarget)) {
        setIsHoveringMergeRequest(false);
      }
    };

    document.addEventListener('pointerover', handlePointerOver);
    document.addEventListener('pointerout', handlePointerOut);
    return () => {
      document.removeEventListener('pointerover', handlePointerOver);
      document.removeEventListener('pointerout', handlePointerOut);
    };
  }, []);

  useEffect(() => {
    if (!service || initialProjectIds === null) return;
    updateURL(effectiveFilters, selectedProjects.map((project) => project.id));
  }, [effectiveFilters, initialProjectIds, selectedProjects, service]);

  const handleProjectsChange = (projects: GitLabProject[]) => {
    setSelectedProjects(projects);
    setProjectResolutionWarnings([]);
    setInitialProjectIds([]);
  };

  const handleStartSemanticReview = useCallback((mergeRequest: GitLabMergeRequest) => {
    const location = { projectId: mergeRequest.project_id, iid: mergeRequest.iid };
    pushGuidedReviewURL(location);
    setGuidedReviewLocation(location);
    setReviewingMergeRequest(mergeRequest);
  }, []);

  const handleCloseGuidedReview = useCallback(() => {
    const guidedReview = decodeGuidedReviewFromURL(new URLSearchParams(window.location.search));
    if (guidedReview && isGuidedReviewHistoryEntry()) {
      window.history.back();
      return;
    }

    clearGuidedReviewURL();
    setGuidedReviewLocation(null);
    setReviewingMergeRequest(null);
    void loadMergeRequests();
  }, [loadMergeRequests]);

  const handleConfigured = useCallback((configuredService: GitLabService, configuredAi: AiProviderConfig | null) => {
    setService(configuredService);
    setAiConfig(configuredAi);
  }, []);

  const handleConnectionSettingsSave = useCallback((
    configuredService: GitLabService,
    nextConfig: AiProviderConfig | null,
    rememberAiSettings: boolean,
    connectionChanged: boolean,
    instanceChanged: boolean
  ) => {
    setAiConfig(nextConfig);
    if (nextConfig && rememberAiSettings) {
      writeAiProviderConfig(nextConfig);
    } else {
      clearAiProviderConfig();
    }

    if (connectionChanged) {
      resetMergeRequestResults();
      setService(configuredService);
      setCurrentUser(null);
      setNavigationError(null);

      if (instanceChanged) {
        setSelectedProjects([]);
        setFilters({ state: 'opened' });
        setQuickFilter(null);
        setInitialProjectIds([]);
        setReviewingMergeRequest(null);
        setGuidedReviewLocation(null);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }

    setIsConnectionSettingsOpen(false);
  }, [resetMergeRequestResults]);

  const handleFiltersChange = (nextFilters: FilterOptions) => {
    setQuickFilter(null);
    setFilters(nextFilters);
  };

  const handleQuickFilterToggle = (filter: LegacyQuickFilter) => {
    setQuickFilter((current) => current === filter ? null : filter);
  };

  const handleRefresh = () => {
    service?.clearApprovalCache();
    service?.clearDiffStatsCache();
    void loadMergeRequests();
  };

  const handleAutoRefreshEnabledChange = (enabled: boolean) => {
    setAutoRefreshEnabled(enabled);
    localStorage.setItem(AUTO_REFRESH_ENABLED_KEY, String(enabled));
  };

  const handleShareURL = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareNotice('View URL copied to the clipboard.');
    } catch {
      setShareNotice(`Clipboard access is unavailable. Copy this URL: ${window.location.href}`);
    }
  };

  const handleDisconnect = () => {
    resetMergeRequestResults();
    setService(null);
    setSelectedProjects([]);
    setCurrentUser(null);
    setAiConfig(null);
    setIsConnectionSettingsOpen(false);
    setReviewingMergeRequest(null);
    setGuidedReviewLocation(null);
    setNavigationError(null);
    setFilters({ state: 'opened' });
    setInitialProjectIds([]);
    localStorage.removeItem('gitlab-instance-url');
    localStorage.removeItem('gitlab-token');
    clearAiProviderConfig();
    window.history.replaceState({}, '', window.location.pathname);
  };

  const connectionSettingsModal = service && isConnectionSettingsOpen ? (
    <ConnectionSettingsModal
      service={service}
      aiConfig={aiConfig}
      onClose={() => setIsConnectionSettingsOpen(false)}
      onSave={handleConnectionSettingsSave}
      onDisconnect={handleDisconnect}
    />
  ) : null;

  if (service && reviewingMergeRequest) {
    return (
      <>
        <SemanticReviewWorkspace
          key={`${reviewingMergeRequest.project_id}-${reviewingMergeRequest.iid}`}
          service={service}
          mergeRequest={reviewingMergeRequest}
          aiConfig={aiConfig}
          onClose={handleCloseGuidedReview}
          onOpenAiSettings={() => setIsConnectionSettingsOpen(true)}
        />
        {connectionSettingsModal}
      </>
    );
  }

  if (!service) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-neutral-900">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8 text-center">
            <h1 className="mb-4 text-4xl font-bold text-gray-900 dark:text-white">GitLab MR Viewer</h1>
            <p className="mx-auto max-w-2xl text-lg text-gray-600 dark:text-gray-400">A lightweight, client-side web app for advanced filtering and viewing of GitLab merge requests. Filter by multiple authors, share URLs with your team, and keep your API token secure in your browser.</p>
          </div>
          <ConfigForm onConfigured={handleConfigured} />
        </div>
      </div>
    );
  }

  return (
    <>
      <LegacyWorkspace
        service={service}
        selectedProjects={selectedProjects}
        onProjectsChange={handleProjectsChange}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        mergeRequests={mergeRequests}
        loading={loading}
        loadingMore={loadingMore}
        error={loadError ?? navigationError}
        warnings={Array.from(new Set([...projectResolutionWarnings, ...loadWarnings]))}
        hasMore={hasMore}
        currentUser={currentUser}
        quickFilter={quickFilter}
        onQuickFilterToggle={handleQuickFilterToggle}
        onRefresh={handleRefresh}
        onLoadMore={() => void loadMergeRequests(true)}
        onShare={handleShareURL}
        shareNotice={shareNotice}
        onDismissShareNotice={() => setShareNotice(null)}
        onOpenConnectionSettings={() => setIsConnectionSettingsOpen(true)}
        autoRefreshEnabled={autoRefreshEnabled}
        onAutoRefreshEnabledChange={handleAutoRefreshEnabledChange}
        onStartSemanticReview={handleStartSemanticReview}
      />
      {connectionSettingsModal}
    </>
  );
}
