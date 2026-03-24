'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import ConfigForm from '@/components/ConfigForm';
import ProjectSelector from '@/components/ProjectSelector';
import FilterPanel from '@/components/FilterPanel';
import MergeRequestList from '@/components/MergeRequestList';
import { GitLabService } from '@/services/gitlab';
import { GitLabProject, GitLabMergeRequest, GitLabUser, FilterOptions } from '@/types/gitlab';
import { decodeFiltersFromURL, updateURL } from '@/utils/urlState';
import { loadUIState, saveUIState } from '@/utils/uiState';

export default function HomeContent() {
  const [searchParams, setSearchParams] = useState<URLSearchParams | null>(null);
  const [service, setService] = useState<GitLabService | null>(null);
  const [selectedProject, setSelectedProject] = useState<GitLabProject | null>(null);
  const [mergeRequests, setMergeRequests] = useState<GitLabMergeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterOptions>({ state: 'opened' });
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [urlProjectId, setUrlProjectId] = useState<number | undefined>();
  const [currentUser, setCurrentUser] = useState<GitLabUser | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const approvalAbortControllerRef = useRef<AbortController | null>(null);

  // Initialize UI state from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedUIState = loadUIState();
      if (savedUIState.filtersExpanded !== undefined) {
        setFiltersExpanded(savedUIState.filtersExpanded);
      }
    }
  }, []);

  // Initialize search params on client side only
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSearchParams(new URLSearchParams(window.location.search));
    }
  }, []);

  const hydrateApprovalStatuses = useCallback(async (mergeRequestList: GitLabMergeRequest[]) => {
    if (!service) return;

    if (approvalAbortControllerRef.current) {
      approvalAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    approvalAbortControllerRef.current = controller;

    try {
      const enrichedMergeRequests = await service.enrichMergeRequestsWithApprovalStatus(mergeRequestList, controller.signal);

      if (!controller.signal.aborted) {
        setMergeRequests(enrichedMergeRequests);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Request cancelled') {
        return;
      }

      console.warn('Failed to hydrate approval statuses:', error);
    }
  }, [service]);

  const shouldHydrateApprovalStatuses = (currentFilters: FilterOptions) => !currentFilters.approvalState && !currentFilters.notReviewedByMe;

  useEffect(() => {
    if (!service) {
      setCurrentUser(null);
      return;
    }

    service.getCurrentUser()
      .then(setCurrentUser)
      .catch((userError) => {
        console.warn('Failed to load current user:', userError);
        setCurrentUser(null);
      });
  }, [service]);

  const loadAllMergeRequests = useCallback(async (currentFilters: FilterOptions) => {
    if (!service) return;

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (approvalAbortControllerRef.current) {
      approvalAbortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    console.log('Loading all merge requests with filters:', currentFilters);
    setLoading(true);
    setError(null);

    try {
      const startTime = Date.now();
      const mrs = await service.getAllMergeRequests(currentFilters, controller.signal);
      const endTime = Date.now();
      console.log(`Loaded ${mrs.length} merge requests in ${endTime - startTime}ms`);
      
      // Only update state if this request wasn't cancelled
      if (!controller.signal.aborted) {
        setMergeRequests(mrs);
        if (shouldHydrateApprovalStatuses(currentFilters)) {
          void hydrateApprovalStatuses(mrs);
        }
      }
    } catch (err) {
      // Don't show errors for cancelled requests
      if (err instanceof Error && err.message === 'Request cancelled') {
        console.log('Request was cancelled');
        return;
      }
      
      console.error('Error loading merge requests:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load merge requests';
      
      // Check if this is just the initial load without specific filters
      const hasSpecificFilters = currentFilters.authors?.length || 
                                currentFilters.approvalState ||
                                currentFilters.notReviewedByMe ||
                                currentFilters.title ||
                                currentFilters.dateFrom || 
                                currentFilters.dateTo;

      // For initial load without filters, show a gentler message
      if (!hasSpecificFilters && errorMessage.includes('timed out')) {
        setError(
          'Unable to load recent merge requests automatically.\n\n' +
          'This is normal for very large GitLab instances. To view merge requests:\n' +
          '• Select a specific project from the dropdown above, or\n' +
          '• Use the filters below to search by author, title, etc.'
        );
      } else {
        setError(errorMessage);
        
        // If it's a timeout error with filters, suggest alternatives
        if (errorMessage.includes('timed out') || errorMessage.includes('Unable to load')) {
          setError(
            errorMessage + 
            '\n\nTips to resolve this:\n' +
            '• Select a specific project from the dropdown above for faster loading\n' +
            '• Use author filters to search for specific people\'s merge requests\n' +
            '• Your GitLab instance has many projects - try narrowing your search'
          );
        }
      }
      
      setMergeRequests([]);
    } finally {
      // Only clear loading if this request wasn't cancelled
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [service, hydrateApprovalStatuses]);

  const loadMergeRequests = useCallback(async (project: GitLabProject, currentFilters: FilterOptions) => {
    if (!service) return;

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (approvalAbortControllerRef.current) {
      approvalAbortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const mrs = await service.getMergeRequests(project.id, currentFilters, controller.signal);
      
      // Only update state if this request wasn't cancelled
      if (!controller.signal.aborted) {
        setMergeRequests(mrs);
        if (shouldHydrateApprovalStatuses(currentFilters)) {
          void hydrateApprovalStatuses(mrs);
        }
      }
    } catch (err) {
      // Don't show errors for cancelled requests
      if (err instanceof Error && err.message === 'Request cancelled') {
        console.log('Request was cancelled');
        return;
      }
      
      setError(err instanceof Error ? err.message : 'Failed to load merge requests');
      setMergeRequests([]);
    } finally {
      // Only clear loading if this request wasn't cancelled
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [service, hydrateApprovalStatuses]);

  // Initialize filters from URL on mount and load all MRs
  useEffect(() => {
    if (!searchParams) return; // Wait for client-side initialization
    
    console.log('URL params effect running with service:', !!service);
    const { filters: urlFilters, projectId } = decodeFiltersFromURL(searchParams);
    setFilters(urlFilters);
    setUrlProjectId(projectId);
    
    // Expand filters if any non-default filters are set
    const hasNonDefaultFilters = urlFilters.state !== 'opened' || 
      urlFilters.approvalState ||
      urlFilters.notReviewedByMe ||
      urlFilters.authors?.length || 
      urlFilters.title || 
      urlFilters.excludeTitle ||
      urlFilters.draft !== undefined || 
      urlFilters.dateFrom || 
      urlFilters.dateTo ||
      urlFilters.projects?.length;
    
    // Only auto-expand if user hasn't explicitly saved a preference
    const savedUIState = loadUIState();
    if (hasNonDefaultFilters && savedUIState.filtersExpanded === undefined) {
      setFiltersExpanded(true);
      saveUIState({ filtersExpanded: true });
    }

    // Load all MRs when service is available and no specific project is selected
    if (service && !projectId) {
      loadAllMergeRequests(urlFilters);
    }
  }, [searchParams, service, loadAllMergeRequests]);

  // Auto-select project from URL when service is available
  useEffect(() => {
    if (service && urlProjectId && !selectedProject) {
      // Try to load the project from the URL
      service.getProjects().then(projects => {
        const project = projects.find(p => p.id === urlProjectId);
        if (project) {
          setSelectedProject(project);
          loadMergeRequests(project, filters);
        }
      }).catch(() => {
        console.warn('Failed to load project from URL');
      });
    } else if (service && !urlProjectId) {
      // Just load all MRs when no specific project is selected
      // We don't need to store all projects in state
    }
  }, [service, urlProjectId, selectedProject, filters, loadMergeRequests]);

  const handleProjectSelect = (project: GitLabProject | null) => {
    setSelectedProject(project);
    if (project) {
      updateURL(filters, project.id);
      loadMergeRequests(project, filters);
    } else {
      updateURL(filters, undefined);
      loadAllMergeRequests(filters);
    }
  };

  const handleFiltersChange = (newFilters: FilterOptions) => {
    setFilters(newFilters);
    updateURL(newFilters, selectedProject?.id);
    if (selectedProject) {
      loadMergeRequests(selectedProject, newFilters);
    } else {
      loadAllMergeRequests(newFilters);
    }
  };

  const handleFiltersToggle = () => {
    const newExpanded = !filtersExpanded;
    setFiltersExpanded(newExpanded);
    saveUIState({ filtersExpanded: newExpanded });
  };

  const handleNeedsApprovalChipToggle = () => {
    const newFilters: FilterOptions = {
      ...filters,
      approvalState: filters.approvalState === 'needs-review' ? undefined : 'needs-review'
    };

    handleFiltersChange(newFilters);
  };

  const handleNotReviewedByMeChipToggle = () => {
    const newFilters: FilterOptions = {
      ...filters,
      notReviewedByMe: filters.notReviewedByMe ? undefined : true
    };

    handleFiltersChange(newFilters);
  };

  const handleRefresh = () => {
    service?.clearApprovalCache();

    if (selectedProject) {
      loadMergeRequests(selectedProject, filters);
    } else {
      loadAllMergeRequests(filters);
    }
  };

  const handleShareURL = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      // You could add a toast notification here
      alert('URL copied to clipboard!');
    } catch {
      // Fallback for browsers that don't support clipboard API
      alert(`Share this URL: ${window.location.href}`);
    }
  };

  const handleDisconnect = () => {
    // Cancel any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (approvalAbortControllerRef.current) {
      approvalAbortControllerRef.current.abort();
      approvalAbortControllerRef.current = null;
    }
    
    setService(null);
    setSelectedProject(null);
    setMergeRequests([]);
    setError(null);
    setCurrentUser(null);
    setUrlProjectId(undefined);
    setFilters({ state: 'opened' });
    localStorage.removeItem('gitlab-instance-url');
    localStorage.removeItem('gitlab-token');
    
    // Clear URL parameters
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url.toString());
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (approvalAbortControllerRef.current) {
        approvalAbortControllerRef.current.abort();
      }
    };
  }, []);

  if (!service) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-neutral-900">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
              GitLab MR Viewer
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              A lightweight, client-side web app for advanced filtering and viewing of GitLab merge requests. 
              Filter by multiple authors, share URLs with your team, and keep your API token secure in your browser.
            </p>
          </div>
          <ConfigForm onConfigured={setService} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-neutral-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            GitLab MR Viewer
          </h1>
          <div className="flex items-center space-x-4">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            {selectedProject && (
              <button
                onClick={handleShareURL}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
              >
                Share URL
              </button>
            )}
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              Disconnect
            </button>
          </div>
        </div>

        {/* Project Selector */}
        <div className="mb-6">
          <ProjectSelector
            service={service}
            selectedProject={selectedProject}
            onProjectSelect={handleProjectSelect}
          />
        </div>

        {/* Filters */}
        {service && (
          <div className="mb-6">
            <FilterPanel
              filters={filters}
              onFiltersChange={handleFiltersChange}
              isExpanded={filtersExpanded}
              onToggle={handleFiltersToggle}
              service={service}
            />
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/20 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-400 rounded-md">
            <div className="whitespace-pre-line">{error}</div>
          </div>
        )}

        {!error && (
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              onClick={handleNeedsApprovalChipToggle}
              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                filters.approvalState === 'needs-review'
                  ? 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:border-rose-800'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-neutral-800 dark:text-gray-200 dark:border-neutral-600 dark:hover:bg-neutral-700'
              }`}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86l-7.5 13A1 1 0 003.66 18h16.68a1 1 0 00.87-1.5l-7.5-13a1 1 0 00-1.74 0z" />
              </svg>
              Needs approval
            </button>


            <button
              onClick={handleNotReviewedByMeChipToggle}
              disabled={!currentUser}
              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                filters.notReviewedByMe
                  ? 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-200 dark:border-sky-800'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-neutral-800 dark:text-gray-200 dark:border-neutral-600 dark:hover:bg-neutral-700'
              } ${!currentUser ? 'cursor-not-allowed opacity-60 hover:bg-white dark:hover:bg-neutral-800' : ''}`}
              title={currentUser ? `Show merge requests not approved by @${currentUser.username}` : 'Loading current user'}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9a3 3 0 11-6 0 3 3 0 016 0zm-9 3a3 3 0 11-6 0 3 3 0 016 0zm9 9v-1a4 4 0 00-4-4h-1m-8 5v-1a4 4 0 014-4h1m0 0a3 3 0 013 3v1m-3-4a3 3 0 00-3 3v1" />
              </svg>
              Not reviewed by me
            </button>
          </div>
        )}


        {/* Results Summary */}
        {!loading && !error && (
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {selectedProject ? (
              <>
                Found {mergeRequests.length} merge request{mergeRequests.length !== 1 ? 's' : ''}
                {' '}in <strong>{selectedProject.path_with_namespace}</strong>
                {filters.authors && filters.authors.length > 0 && (
                  <span> by {filters.authors.join(', ')}</span>
                )}
              </>
            ) : (
              <>
                {(() => {
                  const hasSpecificFilters = filters.authors?.length || 
                                            filters.approvalState ||
                                            filters.notReviewedByMe ||
                                            filters.title ||
                                            filters.dateFrom || 
                                            filters.dateTo;
                  
                  if (!hasSpecificFilters) {
                    return (
                      <>
                        Showing {mergeRequests.length} of your recent merge request{mergeRequests.length !== 1 ? 's' : ''} across all projects.
                        <br />
                        <span className="text-violet-600 dark:text-violet-400 font-medium">
                          💡 Use the filters above to search for more merge requests.
                        </span>
                      </>
                    );
                  } else {
                    return (
                      <>
                        Found {mergeRequests.length} merge request{mergeRequests.length !== 1 ? 's' : ''} across all projects
                        {filters.authors && filters.authors.length > 0 && (
                          <span> by {filters.authors.join(', ')}</span>
                        )}
                      </>
                    );
                  }
                })()}
              </>
            )}
          </div>
        )}
        {/* Merge Requests List */}
        <MergeRequestList 
          mergeRequests={mergeRequests} 
          loading={loading} 
          showProjectInfo={!selectedProject}
          loadingMessage={!selectedProject ? 
            ((() => {
              const hasSpecificFilters = filters.authors?.length || 
                                        filters.approvalState ||
                                        filters.notReviewedByMe ||
                                        filters.title ||
                                        filters.dateFrom || 
                                        filters.dateTo;
              
              return hasSpecificFilters ? 
                "Searching merge requests across all projects..." : 
                "Loading 5 most recent merge requests...";
            })()) : 
            undefined
          }
        />

        {/* Instructions when no MRs and not loading */}
        {!loading && mergeRequests.length === 0 && !error && (
          <div className="text-center py-12">
            <div className="text-gray-500 dark:text-gray-400 text-lg mb-2">
              {selectedProject ? 'No merge requests found in this project' : 'No merge requests found'}
            </div>
            <div className="text-gray-400 dark:text-gray-500 text-sm">
              {selectedProject 
                ? 'Try adjusting your filters or select a different project'
                : 'Try adjusting your filters or select a specific project'
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
