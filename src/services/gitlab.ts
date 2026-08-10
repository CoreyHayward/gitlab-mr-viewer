import {
  GitLabProject,
  GitLabMergeRequest,
  GitLabMergeRequestApprovalStatus,
  GitLabMergeRequestReviewDetails,
  GitLabMergeRequestDiscussion,
  GitLabDiscussionNote,
  GitLabDiscussionPosition,
  GitLabCommitComparison,
  GitLabMergeRequestDiffStats,
  GitLabMergeTrain,
  GitLabMergeTrainProjectStatus,
  GitLabUser,
  GitLabGroup,
  FilterOptions
} from '@/types/gitlab';
import { GitLabApiError, GitLabHttpClient, GitLabRequestCancelledError, mapWithConcurrency } from '@/services/gitlab/http';
import {
  applyMergeRequestFilters,
  buildMergeRequestTargets,
  mergeRequestSortTimestamp,
  uniqueStrings,
  type MergeRequestLoadResult,
  type MergeRequestPageCursor,
  type MergeRequestQueryTarget
} from '@/services/gitlab/mergeRequests';

export type { MergeRequestLoadResult, MergeRequestPageCursor } from '@/services/gitlab/mergeRequests';

const isCancelled = (error: unknown): error is GitLabRequestCancelledError => (
  error instanceof GitLabRequestCancelledError
);

const messageFrom = (error: unknown) => error instanceof Error ? error.message : 'Unknown error';

const isTimeout = (error: unknown) => {
  if (!(error instanceof Error) || !/(?:timed?\s*out|timeout)/i.test(error.message)) return false;
  return !(error instanceof GitLabApiError) || error.status === 408 || error.status >= 500;
};

const TIMEOUT_RETRY_PAGE_SIZE = 5;
const ALL_PROJECTS_BATCH_SIZE = 4;
const ALL_PROJECT_MERGE_REQUEST_PAGE_SIZE = 5;
const MAX_GLOBAL_AUTHOR_QUERIES = 20;
const GLOBAL_AUTHOR_MERGE_REQUEST_PAGE_SIZE = 20;
const MERGE_REQUEST_DETAILS_BATCH_SIZE = 20;
const DEFAULT_MERGE_REQUEST_QUERY_CONCURRENCY = 4;
const AUTHOR_MERGE_REQUEST_QUERY_CONCURRENCY = 8;
const MEMBER_PROJECTS_ENDPOINT = '/projects?membership=true&simple=true&with_merge_requests_enabled=true&order_by=last_activity_at&sort=desc';

type MergeRequestDetailsNode = {
  iid: string;
  approvalsRequired?: number | null;
  approvalsLeft?: number | null;
  approvedBy?: {
    nodes: Array<{
      id: string;
      name: string;
      username: string;
      avatarUrl?: string | null;
    }>;
  } | null;
  diffStatsSummary?: {
    additions: number;
    deletions: number;
    fileCount: number;
  } | null;
};

type MergeRequestDetailsQuery = {
  project?: {
    name: string;
    fullPath: string;
    webUrl: string;
    mergeRequests?: {
      nodes: MergeRequestDetailsNode[];
    } | null;
  } | null;
};

const numericIdFromGlobalId = (id: string) => {
  const numericId = Number.parseInt(id.match(/\/(\d+)$/)?.[1] ?? '', 10);
  return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : 0;
};

type CachedProject = Pick<GitLabProject, 'id' | 'name' | 'path_with_namespace' | 'web_url'>;
type ProjectCache = Record<number, { project: CachedProject; timestamp: number }>;

const projectFromMergeRequestReference = (mergeRequest: GitLabMergeRequest): CachedProject | null => {
  const fullReference = mergeRequest.references?.full;
  const separatorIndex = fullReference?.lastIndexOf('!') ?? -1;
  const mergeRequestMarker = '/-/merge_requests/';
  const markerIndex = mergeRequest.web_url.indexOf(mergeRequestMarker);
  if (!fullReference || separatorIndex <= 0 || markerIndex <= 0) return null;

  const pathWithNamespace = fullReference.slice(0, separatorIndex);
  const name = pathWithNamespace.split('/').at(-1);
  if (!name) return null;
  return {
    id: mergeRequest.project_id,
    name,
    path_with_namespace: pathWithNamespace,
    web_url: mergeRequest.web_url.slice(0, markerIndex)
  };
};

const cachedProjectEntryFrom = (value: unknown): { project: CachedProject; timestamp: number } | null => {
  if (!value || typeof value !== 'object') return null;
  const entry = value as { project?: unknown; timestamp?: unknown };
  if (!entry.project || typeof entry.project !== 'object' || typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp)) return null;
  const project = entry.project as Partial<CachedProject>;
  if (
    !Number.isSafeInteger(project.id) || Number(project.id) <= 0 ||
    typeof project.name !== 'string' ||
    typeof project.path_with_namespace !== 'string' ||
    typeof project.web_url !== 'string'
  ) return null;
  return { project: project as CachedProject, timestamp: entry.timestamp };
};

export class GitLabService {
  private readonly http: GitLabHttpClient;
  private currentUser: GitLabUser | null = null;
  private readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds
  private readonly CACHE_KEY_PREFIX: string;
  private readonly APPROVAL_CACHE_DURATION = 5 * 60 * 1000;
  private readonly APPROVAL_BATCH_SIZE = 8;
  private approvalCache = new Map<string, { status: GitLabMergeRequestApprovalStatus; timestamp: number }>();
  private readonly DIFF_STATS_CACHE_DURATION = 5 * 60 * 1000;
  private readonly DIFF_STATS_PROJECT_BATCH_SIZE = 4;
  private diffStatsCache = new Map<string, { stats: GitLabMergeRequestDiffStats; timestamp: number }>();
  private readonly ACTIVE_MERGE_TRAIN_STATUSES = new Set(['idle', 'fresh', 'stale']);

  constructor(instanceUrl: string, token: string) {
    this.http = new GitLabHttpClient(instanceUrl, token);
    this.CACHE_KEY_PREFIX = `gitlab-project-cache:${encodeURIComponent(this.http.baseUrl.toLowerCase())}`;
  }

  getInstanceUrl(): string {
    return this.http.baseUrl;
  }

  getCurrentUserId(): number | null {
    return this.currentUser?.id ?? null;
  }

  private getProjectCacheKey(): string | null {
    return this.currentUser ? `${this.CACHE_KEY_PREFIX}:${this.currentUser.id}` : null;
  }

  private async enrichMergeRequestsWithProjects(
    mergeRequests: GitLabMergeRequest[],
    signal?: AbortSignal,
    warnings: string[] = [],
    knownProjects: GitLabProject[] = []
  ): Promise<GitLabMergeRequest[]> {
    const projectIds = [...new Set(mergeRequests.map(mr => mr.project_id))];
    const cache = this.loadProjectCache();
    const projectsMap = new Map<number, CachedProject>(knownProjects.map((project) => [project.id, {
      id: project.id,
      name: project.name,
      path_with_namespace: project.path_with_namespace,
      web_url: project.web_url
    }]));
    const projectsToFetch: number[] = [];
    const now = Date.now();

    projectsMap.forEach((project, projectId) => {
      cache[projectId] = { project, timestamp: now };
    });

    for (const projectId of projectIds) {
      if (projectsMap.has(projectId)) continue;
      const cached = cache[projectId];
      if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
        projectsMap.set(projectId, cached.project);
      } else {
        projectsToFetch.push(projectId);
      }
    }

    const results = await mapWithConcurrency(projectsToFetch, 6, async (projectId) => {
      const project = await this.http.request<GitLabProject>(`/projects/${projectId}`, 10_000, signal);
      return {
        id: project.id,
        name: project.name,
        path_with_namespace: project.path_with_namespace,
        web_url: project.web_url
      };
    });

    results.forEach((result, index) => {
      const projectId = projectsToFetch[index];
      if (result.status === 'rejected') {
        if (isCancelled(result.reason)) throw result.reason;
        warnings.push(`Project ${projectId} details could not be loaded: ${messageFrom(result.reason)}`);
        return;
      }

      projectsMap.set(projectId, result.value);
      cache[projectId] = { project: result.value, timestamp: now };
    });

    this.saveProjectCache(cache);

    return mergeRequests.map(mr => ({
      ...mr,
      project: projectsMap.get(mr.project_id)
    }));
  }

  private loadProjectCache(): ProjectCache {
    const cacheKey = this.getProjectCacheKey();
    if (!cacheKey || typeof localStorage === 'undefined') return {};

    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cache = JSON.parse(cached);
        // Clean up expired entries
        const now = Date.now();
        const cleanedCache: ProjectCache = {};
        let removedCount = 0;
        
        for (const [id, entry] of Object.entries(cache)) {
          const numericId = Number(id);
          const typedEntry = cachedProjectEntryFrom(entry);
          if (Number.isSafeInteger(numericId) && numericId > 0 && typedEntry && typedEntry.project.id === numericId && now - typedEntry.timestamp < this.CACHE_DURATION) {
            cleanedCache[numericId] = typedEntry;
          } else {
            removedCount++;
          }
        }
        
        if (removedCount > 0) {
          this.saveProjectCache(cleanedCache);
        }
        
        return cleanedCache;
      }
    } catch (error) {
      console.warn('Failed to load project cache from localStorage:', error);
    }
    return {};
  }

  private saveProjectCache(cache: ProjectCache): void {
    const cacheKey = this.getProjectCacheKey();
    if (!cacheKey || typeof localStorage === 'undefined') return;

    try {
      localStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch (error) {
      console.warn('Failed to save project cache to localStorage:', error);
    }
  }

  // Method to clear project cache if needed
  clearProjectCache(): void {
    const cacheKey = this.getProjectCacheKey();
    if (!cacheKey || typeof localStorage === 'undefined') return;

    try {
      localStorage.removeItem(cacheKey);
    } catch (error) {
      console.warn('Failed to clear project cache:', error);
    }
  }

  clearApprovalCache(): void {
    this.approvalCache.clear();
  }

  clearDiffStatsCache(): void {
    this.diffStatsCache.clear();
  }

  private getDiffStatsCacheKey(projectId: number, mergeRequestIid: number): string {
    return `${projectId}:${mergeRequestIid}`;
  }

  private getCachedDiffStats(projectId: number, mergeRequestIid: number): GitLabMergeRequestDiffStats | null {
    const cacheKey = this.getDiffStatsCacheKey(projectId, mergeRequestIid);
    const cached = this.diffStatsCache.get(cacheKey);
    if (!cached) {
      return null;
    }
    if (Date.now() - cached.timestamp >= this.DIFF_STATS_CACHE_DURATION) {
      this.diffStatsCache.delete(cacheKey);
      return null;
    }
    return cached.stats;
  }

  private async fetchDiffStatsForProject(
    fullPath: string,
    iids: number[],
    signal?: AbortSignal
  ): Promise<Map<number, GitLabMergeRequestDiffStats>> {
    const query = `query DiffStats($fullPath: ID!, $iids: [String!]!) {
      project(fullPath: $fullPath) {
        mergeRequests(iids: $iids) {
          nodes {
            iid
            diffStatsSummary {
              additions
              deletions
              fileCount
            }
          }
        }
      }
    }`;

    const data = await this.http.graphQL<{
      project?: {
        mergeRequests?: {
          nodes: Array<{
            iid: string;
            diffStatsSummary?: { additions: number; deletions: number; fileCount: number } | null;
          }>;
        } | null;
      } | null;
    }>(query, { fullPath, iids: iids.map(String) }, 8000, signal);

    const result = new Map<number, GitLabMergeRequestDiffStats>();
    const nodes = data?.project?.mergeRequests?.nodes ?? [];
    for (const node of nodes) {
      if (!node.diffStatsSummary) continue;
      result.set(Number(node.iid), {
        additions: node.diffStatsSummary.additions,
        deletions: node.diffStatsSummary.deletions,
        file_count: node.diffStatsSummary.fileCount
      });
    }
    return result;
  }

  async enrichMergeRequestsWithDetails(
    mergeRequests: GitLabMergeRequest[],
    signal?: AbortSignal,
    bypassCache: boolean = false,
    warnings: string[] = []
  ): Promise<GitLabMergeRequest[]> {
    const query = `query MergeRequestDetails($fullPath: ID!, $iids: [String!]!, $first: Int!) {
      project(fullPath: $fullPath) {
        name
        fullPath
        webUrl
        mergeRequests(iids: $iids, first: $first) {
          nodes {
            iid
            approvalsRequired
            approvalsLeft
            approvedBy {
              nodes {
                id
                name
                username
                avatarUrl
              }
            }
            diffStatsSummary {
              additions
              deletions
              fileCount
            }
          }
        }
      }
    }`;
    const groups = new Map<string, GitLabMergeRequest[]>();
    const projectCache = this.loadProjectCache();
    const projectsById = new Map<number, CachedProject>(
      Array.from(new Set(mergeRequests.map(({ project_id }) => project_id)))
        .flatMap((projectId) => projectCache[projectId]
          ? [[projectId, projectCache[projectId].project] as const]
          : [])
    );
    const refreshedProjectsById = new Map<number, CachedProject>();

    for (const mergeRequest of mergeRequests) {
      const fullPath = mergeRequest.project?.path_with_namespace;
      if (!fullPath) continue;
      const hasApproval = mergeRequest.state !== 'opened' || (
        !bypassCache && this.getCachedApprovalStatus(mergeRequest.project_id, mergeRequest.iid) !== null
      );
      const hasDiffStats = !bypassCache && this.getCachedDiffStats(mergeRequest.project_id, mergeRequest.iid) !== null;
      if (hasApproval && hasDiffStats) continue;

      const projectMergeRequests = groups.get(fullPath) ?? [];
      projectMergeRequests.push(mergeRequest);
      groups.set(fullPath, projectMergeRequests);
    }

    const detailTargets = Array.from(groups.entries()).flatMap(([fullPath, projectMergeRequests]) => (
      Array.from({ length: Math.ceil(projectMergeRequests.length / MERGE_REQUEST_DETAILS_BATCH_SIZE) }, (_, index) => [
        fullPath,
        projectMergeRequests.slice(
          index * MERGE_REQUEST_DETAILS_BATCH_SIZE,
          (index + 1) * MERGE_REQUEST_DETAILS_BATCH_SIZE
        )
      ] as const)
    ));
    const results = await mapWithConcurrency(detailTargets, this.DIFF_STATS_PROJECT_BATCH_SIZE, async ([fullPath, projectMergeRequests]) => {
      const data = await this.http.graphQL<MergeRequestDetailsQuery>(
        query,
        {
          fullPath,
          iids: projectMergeRequests.map(({ iid }) => String(iid)),
          first: projectMergeRequests.length
        },
        10_000,
        signal
      );
      const project = data.project;
      const nodes = project?.mergeRequests?.nodes;
      if (!nodes) throw new Error(`GitLab returned no merge request details for ${fullPath}.`);
      const projectId = projectMergeRequests[0]?.project_id;
      if (projectId) {
        const refreshedProject = {
          id: projectId,
          name: project.name,
          path_with_namespace: project.fullPath,
          web_url: project.webUrl
        };
        projectsById.set(projectId, refreshedProject);
        refreshedProjectsById.set(projectId, refreshedProject);
      }

      const mergeRequestsByIid = new Map(projectMergeRequests.map((mergeRequest) => [mergeRequest.iid, mergeRequest]));
      for (const node of nodes) {
        const mergeRequest = mergeRequestsByIid.get(Number(node.iid));
        if (!mergeRequest) continue;

        if (
          mergeRequest.state === 'opened' &&
          typeof node.approvalsRequired === 'number' &&
          typeof node.approvalsLeft === 'number'
        ) {
          this.approvalCache.set(this.getApprovalCacheKey(mergeRequest.project_id, mergeRequest.iid), {
            status: {
              approvals_required: node.approvalsRequired,
              approvals_left: node.approvalsLeft,
              approved_by: (node.approvedBy?.nodes ?? []).map((user) => ({
                approved_at: null,
                user: {
                  id: numericIdFromGlobalId(user.id),
                  name: user.name,
                  username: user.username,
                  avatar_url: user.avatarUrl ?? null
                }
              }))
            },
            timestamp: Date.now()
          });
        }

        if (node.diffStatsSummary) {
          this.diffStatsCache.set(this.getDiffStatsCacheKey(mergeRequest.project_id, mergeRequest.iid), {
            stats: {
              additions: node.diffStatsSummary.additions,
              deletions: node.diffStatsSummary.deletions,
              file_count: node.diffStatsSummary.fileCount
            },
            timestamp: Date.now()
          });
        }
      }
    });

    results.forEach((result) => {
      if (result.status === 'fulfilled') return;
      if (isCancelled(result.reason)) throw result.reason;
      warnings.push(`Merge request details could not be loaded: ${messageFrom(result.reason)}`);
    });

    if (refreshedProjectsById.size > 0) {
      const timestamp = Date.now();
      refreshedProjectsById.forEach((project, projectId) => {
        projectCache[projectId] = { project, timestamp };
      });
      this.saveProjectCache(projectCache);
    }

    return mergeRequests.map((mergeRequest) => ({
      ...mergeRequest,
      project: projectsById.get(mergeRequest.project_id) ?? mergeRequest.project,
      approval_status: this.getCachedApprovalStatus(mergeRequest.project_id, mergeRequest.iid) ?? mergeRequest.approval_status,
      diff_stats: this.getCachedDiffStats(mergeRequest.project_id, mergeRequest.iid) ?? mergeRequest.diff_stats
    }));
  }

  async enrichMergeRequestsWithDiffStats(
    mergeRequests: GitLabMergeRequest[],
    signal?: AbortSignal,
    bypassCache: boolean = false,
    warnings: string[] = []
  ): Promise<GitLabMergeRequest[]> {
    const groups = new Map<string, GitLabMergeRequest[]>();
    for (const mr of mergeRequests) {
      const fullPath = mr.project?.path_with_namespace;
      if (!fullPath) continue;
      if (!bypassCache && this.getCachedDiffStats(mr.project_id, mr.iid)) continue;

      const list = groups.get(fullPath) ?? [];
      list.push(mr);
      groups.set(fullPath, list);
    }

    const projectEntries = Array.from(groups.entries());
    for (let i = 0; i < projectEntries.length; i += this.DIFF_STATS_PROJECT_BATCH_SIZE) {
      if (signal?.aborted) {
        throw new GitLabRequestCancelledError();
      }
      const slice = projectEntries.slice(i, i + this.DIFF_STATS_PROJECT_BATCH_SIZE);
      const results = await Promise.allSettled(
        slice.map(async ([fullPath, mrs]) => {
          const stats = await this.fetchDiffStatsForProject(fullPath, mrs.map((mr) => mr.iid), signal);
          for (const mr of mrs) {
            const stat = stats.get(mr.iid);
            if (stat) {
              this.diffStatsCache.set(this.getDiffStatsCacheKey(mr.project_id, mr.iid), {
                stats: stat,
                timestamp: Date.now()
              });
            }
          }
        })
      );

      results.forEach((result) => {
        if (result.status === 'rejected') {
          if (isCancelled(result.reason)) throw result.reason;
          warnings.push(`Diff statistics could not be loaded: ${messageFrom(result.reason)}`);
        }
      });
    }

    return mergeRequests.map((mr) => {
      const stats = this.getCachedDiffStats(mr.project_id, mr.iid);
      if (!stats) return mr;
      return { ...mr, diff_stats: stats };
    });
  }

  // Method to get cache status (useful for debugging)
  getProjectCacheStatus(): { size: number; entries: Array<{ id: number; name: string; age: string }> } {
    try {
      const cache = this.loadProjectCache();
      const now = Date.now();
      const entries = Object.entries(cache).map(([id, cached]) => ({
        id: parseInt(id),
        name: cached.project.name,
        age: `${Math.round((now - cached.timestamp) / 1000 / 60)}m ago`
      }));
      
      return {
        size: Object.keys(cache).length,
        entries
      };
    } catch (error) {
      console.warn('Failed to get cache status:', error);
      return { size: 0, entries: [] };
    }
  }

  async getProjects(search?: string, signal?: AbortSignal): Promise<GitLabProject[]> {
    let endpoint = '/projects?membership=true&simple=true&order_by=last_activity_at&sort=desc';
    if (search) {
      endpoint += `&search=${encodeURIComponent(search)}`;
    }
    return this.http.requestAllPages<GitLabProject>(endpoint, 30_000, signal);
  }

  async getProject(projectId: number, signal?: AbortSignal): Promise<GitLabProject> {
    return this.http.request<GitLabProject>(`/projects/${projectId}`, 30000, signal);
  }

  async getMergeRequestReviewDetails(
    projectId: number,
    mergeRequestIid: number,
    signal?: AbortSignal
  ): Promise<GitLabMergeRequestReviewDetails> {
    const metadata = await this.http.request<GitLabMergeRequestReviewDetails & { changes_count?: string | null }>(
      `/projects/${projectId}/merge_requests/${mergeRequestIid}`,
      30000,
      signal
    );
    const changes = [] as NonNullable<GitLabMergeRequestReviewDetails['changes']>;
    let page = 1;
    let paginationTruncated = false;

    while (page <= 100) {
      const result = await this.http.requestPage<NonNullable<GitLabMergeRequestReviewDetails['changes']>[number]>(
        `/projects/${projectId}/merge_requests/${mergeRequestIid}/diffs?unidiff=true`,
        page,
        100,
        30_000,
        signal
      );
      changes.push(...result.items);
      if (result.nextPage === null) break;
      if (page === 100) {
        paginationTruncated = true;
        break;
      }
      page = result.nextPage;
    }

    const collapsedFiles = changes.filter((change) => change.collapsed).length;
    const tooLargeFiles = changes.filter((change) => change.too_large).length;
    const generatedFiles = changes.filter((change) => change.generated_file).length;
    const rawChangesCount = metadata.changes_count?.trim() ?? '';
    const countCapped = rawChangesCount.endsWith('+');
    const parsedTotal = Number.parseInt(rawChangesCount, 10);
    const totalFiles = Number.isSafeInteger(parsedTotal) ? parsedTotal : undefined;
    const countTruncated = totalFiles !== undefined && changes.length < totalFiles;
    const truncated = paginationTruncated || countCapped || countTruncated || collapsedFiles > 0 || tooLargeFiles > 0;
    const reasons = [
      paginationTruncated ? 'The merge request has more than 10,000 changed files.' : null,
      countCapped ? `GitLab capped the reported change count at ${totalFiles?.toLocaleString('en-US') ?? 'its display limit'}; the actual total may be higher.` : null,
      countTruncated ? `GitLab reported ${totalFiles} changed files but returned ${changes.length}.` : null,
      collapsedFiles > 0 ? `${collapsedFiles} file${collapsedFiles === 1 ? '' : 's'} were collapsed by GitLab.` : null,
      tooLargeFiles > 0 ? `${tooLargeFiles} file${tooLargeFiles === 1 ? '' : 's'} were too large for GitLab to return.` : null
    ].filter((reason): reason is string => reason !== null);

    return {
      ...metadata,
      changes,
      diff_completeness: {
        complete: !truncated,
        truncated,
        ...(totalFiles === undefined ? {} : { total_files: totalFiles }),
        loaded_files: changes.length,
        collapsed_files: collapsedFiles,
        too_large_files: tooLargeFiles,
        generated_files: generatedFiles,
        ...(reasons.length > 0 ? { reason: reasons.join(' ') } : {})
      }
    };
  }

  async getMergeRequest(
    projectId: number,
    mergeRequestIid: number,
    signal?: AbortSignal
  ): Promise<GitLabMergeRequest> {
    const mergeRequest = await this.http.request<GitLabMergeRequest>(
      `/projects/${projectId}/merge_requests/${mergeRequestIid}`,
      30000,
      signal
    );
    const [enrichedMergeRequest] = await this.enrichMergeRequestsWithProjects([mergeRequest], signal);
    return enrichedMergeRequest ?? mergeRequest;
  }

  async getMergeRequestDiscussions(
    projectId: number,
    mergeRequestIid: number,
    signal?: AbortSignal
  ): Promise<GitLabMergeRequestDiscussion[]> {
    return this.http.requestAllPages<GitLabMergeRequestDiscussion>(
      `/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions`,
      30_000,
      signal
    );
  }

  async createMergeRequestDiscussion(
    projectId: number,
    mergeRequestIid: number,
    body: string,
    position?: GitLabDiscussionPosition,
    signal?: AbortSignal
  ): Promise<GitLabMergeRequestDiscussion> {
    return this.http.request<GitLabMergeRequestDiscussion>(
      `/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions`,
      30000,
      signal,
      {
        method: 'POST',
        body: {
          body,
          ...(position ? { position } : {})
        }
      }
    );
  }

  async addMergeRequestDiscussionNote(
    projectId: number,
    mergeRequestIid: number,
    discussionId: string,
    body: string,
    signal?: AbortSignal
  ): Promise<GitLabDiscussionNote> {
    return this.http.request<GitLabDiscussionNote>(
      `/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions/${encodeURIComponent(discussionId)}/notes`,
      30000,
      signal,
      {
        method: 'POST',
        body: { body }
      }
    );
  }

  async approveMergeRequest(
    projectId: number,
    mergeRequestIid: number,
    headSha?: string
  ): Promise<GitLabMergeRequestApprovalStatus> {
    const sha = headSha && /^[a-f0-9]{7,80}$/i.test(headSha) ? headSha : undefined;
    await this.http.request<GitLabMergeRequest>(
      `/projects/${projectId}/merge_requests/${mergeRequestIid}/approve`,
      10000,
      undefined,
      {
        method: 'POST',
        ...(sha ? { body: { sha } } : {})
      }
    );

    this.approvalCache.delete(this.getApprovalCacheKey(projectId, mergeRequestIid));
    return this.getMergeRequestApprovalStatus(projectId, mergeRequestIid, undefined, true);
  }

  async compareMergeRequestCommits(
    projectId: number,
    from: string,
    to: string,
    signal?: AbortSignal
  ): Promise<GitLabCommitComparison> {
    const params = new URLSearchParams({ from, to, straight: 'true' });
    return this.http.request<GitLabCommitComparison>(
      `/projects/${projectId}/repository/compare?${params.toString()}`,
      15000,
      signal
    );
  }

  async getActiveMergeTrains(projectId: number, signal?: AbortSignal): Promise<GitLabMergeTrain[]> {
    const trains = await this.http.requestAllPages<GitLabMergeTrain>(
      `/projects/${projectId}/merge_trains?scope=active&sort=asc`,
      10000,
      signal
    );

    return trains.filter((train) => (
      this.ACTIVE_MERGE_TRAIN_STATUSES.has(train.status) &&
      train.merge_request.state === 'opened' &&
      train.merged_at === null &&
      train.duration === null
    ));
  }

  async getActiveMergeTrainsForProjects(
    projects: GitLabProject[],
    signal?: AbortSignal
  ): Promise<GitLabMergeTrainProjectStatus[]> {
    const uniqueProjects = Array.from(
      new Map(projects.map((project) => [project.id, project])).values()
    );

    const settled = await mapWithConcurrency(uniqueProjects, 4, async (project) => ({
      project,
      trains: await this.getActiveMergeTrains(project.id, signal)
    }));
    const results = settled.map((result, index): GitLabMergeTrainProjectStatus => {
      if (result.status === 'fulfilled') return result.value;
      if (isCancelled(result.reason)) throw result.reason;
      return {
        project: uniqueProjects[index],
        trains: [],
        error: messageFrom(result.reason)
      };
    });

    return results.sort((a, b) => {
      if (b.trains.length !== a.trains.length) {
        return b.trains.length - a.trains.length;
      }

      return a.project.path_with_namespace.localeCompare(b.project.path_with_namespace);
    });
  }

  async getCurrentUser(signal?: AbortSignal): Promise<GitLabUser> {
    if (this.currentUser) {
      return this.currentUser;
    }

    const user = await this.http.request<GitLabUser>('/user', 30000, signal);
    this.currentUser = user;
    return user;
  }

  private getApprovalCacheKey(projectId: number, mergeRequestIid: number): string {
    return `${projectId}:${mergeRequestIid}`;
  }

  private getCachedApprovalStatus(projectId: number, mergeRequestIid: number): GitLabMergeRequestApprovalStatus | null {
    const cacheKey = this.getApprovalCacheKey(projectId, mergeRequestIid);
    const cached = this.approvalCache.get(cacheKey);

    if (!cached) {
      return null;
    }

    if (Date.now() - cached.timestamp >= this.APPROVAL_CACHE_DURATION) {
      this.approvalCache.delete(cacheKey);
      return null;
    }

    return cached.status;
  }

  private async getMergeRequestApprovalStatus(
    projectId: number,
    mergeRequestIid: number,
    signal?: AbortSignal,
    bypassCache: boolean = false
  ): Promise<GitLabMergeRequestApprovalStatus> {
    const cached = bypassCache ? null : this.getCachedApprovalStatus(projectId, mergeRequestIid);
    if (cached) {
      return cached;
    }

    const approvalStatus = await this.http.request<GitLabMergeRequestApprovalStatus>(
      `/projects/${projectId}/merge_requests/${mergeRequestIid}/approvals`,
      5000,
      signal
    );

    this.approvalCache.set(this.getApprovalCacheKey(projectId, mergeRequestIid), {
      status: approvalStatus,
      timestamp: Date.now()
    });

    return approvalStatus;
  }

  async enrichMergeRequestsWithApprovalStatus(
    mergeRequests: GitLabMergeRequest[],
    signal?: AbortSignal,
    bypassCache: boolean = false,
    warnings: string[] = []
  ): Promise<GitLabMergeRequest[]> {
    const approvalTargets = mergeRequests.filter((mergeRequest) => mergeRequest.state === 'opened');

    if (approvalTargets.length === 0) {
      return mergeRequests;
    }

    const approvalStatusMap = new Map<number, GitLabMergeRequestApprovalStatus>();

    for (let index = 0; index < approvalTargets.length; index += this.APPROVAL_BATCH_SIZE) {
      if (signal?.aborted) {
        throw new GitLabRequestCancelledError();
      }

      const batch = approvalTargets.slice(index, index + this.APPROVAL_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (mergeRequest) => {
          const approvalStatus = await this.getMergeRequestApprovalStatus(
            mergeRequest.project_id,
            mergeRequest.iid,
            signal,
            bypassCache
          );

          return {
            mergeRequestId: mergeRequest.id,
            approvalStatus
          };
        })
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          approvalStatusMap.set(result.value.mergeRequestId, result.value.approvalStatus);
          return;
        }

        if (isCancelled(result.reason)) throw result.reason;
        warnings.push(`Approval status could not be loaded: ${messageFrom(result.reason)}`);
      });
    }

    return mergeRequests.map((mergeRequest) => {
      const approvalStatus = approvalStatusMap.get(mergeRequest.id);

      if (!approvalStatus) {
        return mergeRequest;
      }

      return {
        ...mergeRequest,
        approval_status: approvalStatus
      };
    });
  }

  private async loadMergeRequestTargets(
    targets: MergeRequestQueryTarget[],
    filters: FilterOptions,
    signal?: AbortSignal,
    knownProjects: GitLabProject[] = []
  ): Promise<MergeRequestLoadResult> {
    const warnings: string[] = [];
    const queryConcurrency = uniqueStrings(filters.authors).length > 0
      ? AUTHOR_MERGE_REQUEST_QUERY_CONCURRENCY
      : DEFAULT_MERGE_REQUEST_QUERY_CONCURRENCY;
    const results = await mapWithConcurrency(targets, queryConcurrency, async (target) => {
      const requestPage = (requestTarget: MergeRequestQueryTarget) => (
        this.http.requestPage<GitLabMergeRequest>(
          requestTarget.endpoint,
          requestTarget.page,
          requestTarget.perPage,
          20_000,
          signal
        )
      );

      try {
        return { target, page: await requestPage(target), error: null };
      } catch (error) {
        if (isCancelled(error)) throw error;
        if (target.page !== 1 || target.perPage <= TIMEOUT_RETRY_PAGE_SIZE || !isTimeout(error)) {
          return { target, page: null, error };
        }

        const retryTarget = { ...target, perPage: TIMEOUT_RETRY_PAGE_SIZE };
        try {
          return { target: retryTarget, page: await requestPage(retryTarget), error: null };
        } catch (retryError) {
          if (isCancelled(retryError)) throw retryError;
          return { target: retryTarget, page: null, error: retryError };
        }
      }
    });
    const nextTargets: MergeRequestQueryTarget[] = [];
    const mergeRequestMap = new Map<number, GitLabMergeRequest>();

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        if (isCancelled(result.reason)) throw result.reason;
        const target = targets[index];
        warnings.push(`${target.label} could not be loaded: ${messageFrom(result.reason)}`);
        nextTargets.push(target);
        return;
      }

      const { target, page, error } = result.value;
      if (error || !page) {
        warnings.push(`${target.label} could not be loaded: ${messageFrom(error)}`);
        nextTargets.push(target);
        return;
      }

      for (const mergeRequest of page.items) {
        const existing = mergeRequestMap.get(mergeRequest.id);
        if (!existing || mergeRequestSortTimestamp(mergeRequest, filters) > mergeRequestSortTimestamp(existing, filters)) {
          mergeRequestMap.set(mergeRequest.id, mergeRequest);
        }
      }
      if (page.nextPage !== null) {
        nextTargets.push({ ...target, page: page.nextPage });
      }
    });

    let mergeRequests = Array.from(mergeRequestMap.values());
    if (!this.currentUser) {
      try {
        await this.getCurrentUser(signal);
      } catch (error) {
        if (isCancelled(error)) throw error;
        warnings.push(`Your GitLab user could not be loaded: ${messageFrom(error)}`);
      }
    }
    const requiresExactProjectName = (filters.projects?.length ?? 0) > 0;
    const knownProjectsById = new Map(knownProjects.map((project) => [project.id, project]));
    const projectsFromReferences = new Map<number, CachedProject>();
    if (!requiresExactProjectName) {
      for (const mergeRequest of mergeRequests) {
        const project = knownProjectsById.get(mergeRequest.project_id) ?? projectFromMergeRequestReference(mergeRequest);
        if (project) projectsFromReferences.set(mergeRequest.project_id, project);
      }
    }

    if (!requiresExactProjectName && mergeRequests.every(({ project_id }) => projectsFromReferences.has(project_id))) {
      mergeRequests = mergeRequests.map((mergeRequest) => ({
        ...mergeRequest,
        project: projectsFromReferences.get(mergeRequest.project_id)
      }));
    } else {
      mergeRequests = await this.enrichMergeRequestsWithProjects(mergeRequests, signal, warnings, knownProjects);
    }

    if (filters.approvalState || filters.notReviewedByMe) {
      mergeRequests = await this.enrichMergeRequestsWithDetails(mergeRequests, signal, true, warnings);
    }

    mergeRequests = applyMergeRequestFilters(mergeRequests, filters, this.currentUser?.username);
    mergeRequests.sort((a, b) => mergeRequestSortTimestamp(b, filters) - mergeRequestSortTimestamp(a, filters));

    return {
      mergeRequests,
      nextCursor: nextTargets.length > 0 ? { targets: nextTargets } : null,
      warnings: Array.from(new Set(warnings))
    };
  }

  async getMergeRequests(
    projectId: number,
    filters: FilterOptions = {},
    signal?: AbortSignal,
    cursor?: MergeRequestPageCursor | null
  ): Promise<MergeRequestLoadResult> {
    const targets = cursor?.targets ?? buildMergeRequestTargets([{
      endpoint: `/projects/${projectId}/merge_requests`,
      label: `Project ${projectId}`
    }], filters);
    return this.loadMergeRequestTargets(targets, filters, signal);
  }

  async getMergeRequestsForProjects(
    projectIds: number[],
    filters: FilterOptions = {},
    signal?: AbortSignal,
    cursor?: MergeRequestPageCursor | null
  ): Promise<MergeRequestLoadResult> {
    const uniqueProjectIds = Array.from(new Set(projectIds)).filter((id) => Number.isSafeInteger(id) && id > 0);
    const targets = cursor?.targets ?? buildMergeRequestTargets(
      uniqueProjectIds.map((projectId) => ({
        endpoint: `/projects/${projectId}/merge_requests`,
        label: `Project ${projectId}`
      })),
      filters
    );
    const result = await this.loadMergeRequestTargets(targets, filters, signal);
    if (uniqueProjectIds.length !== new Set(projectIds).size) {
      result.warnings.unshift('One or more invalid project IDs were ignored.');
    }
    return result;
  }

  async getAllMergeRequests(
    filters: FilterOptions = {},
    signal?: AbortSignal,
    cursor?: MergeRequestPageCursor | null
  ): Promise<MergeRequestLoadResult> {
    const authors = uniqueStrings(filters.authors);
    if (authors.length > 0 && authors.length <= MAX_GLOBAL_AUTHOR_QUERIES) {
      const targets = cursor?.targets ?? buildMergeRequestTargets([{
        endpoint: '/merge_requests',
        label: 'Merge requests across all accessible projects',
        globalScope: true,
        perPage: GLOBAL_AUTHOR_MERGE_REQUEST_PAGE_SIZE
      }], filters);
      return this.loadMergeRequestTargets(targets, filters, signal);
    }

    const warnings: string[] = [];
    const queuedTargets = [...(cursor?.targets ?? [])];
    let projectDiscovery = cursor?.projectDiscovery ?? (cursor ? undefined : {
      page: 1,
      perPage: ALL_PROJECTS_BATCH_SIZE
    });
    let discoveredProjects: GitLabProject[] = [];

    if (projectDiscovery) {
      try {
        const projectPage = await this.http.requestPage<GitLabProject>(
          MEMBER_PROJECTS_ENDPOINT,
          projectDiscovery.page,
          projectDiscovery.perPage,
          30_000,
          signal
        );
        discoveredProjects = projectPage.items;
        queuedTargets.push(...buildMergeRequestTargets(
          discoveredProjects.map((project) => ({
            endpoint: `/projects/${project.id}/merge_requests`,
            label: project.path_with_namespace,
            perPage: ALL_PROJECT_MERGE_REQUEST_PAGE_SIZE
          })),
          filters
        ));
        projectDiscovery = projectPage.nextPage === null ? undefined : {
          ...projectDiscovery,
          page: projectPage.nextPage
        };
      } catch (error) {
        if (isCancelled(error)) throw error;
        warnings.push(`Your GitLab projects could not be loaded: ${messageFrom(error)}`);
      }
    }

    const activeTargets = queuedTargets.slice(0, ALL_PROJECTS_BATCH_SIZE);
    const deferredTargets = queuedTargets.slice(ALL_PROJECTS_BATCH_SIZE);
    const result = await this.loadMergeRequestTargets(activeTargets, filters, signal, discoveredProjects);
    const nextTargets = [
      ...deferredTargets,
      ...(result.nextCursor?.targets ?? [])
    ];

    return {
      ...result,
      nextCursor: nextTargets.length > 0 || projectDiscovery
        ? {
            targets: nextTargets,
            ...(projectDiscovery ? { projectDiscovery } : {})
          }
        : null,
      warnings: Array.from(new Set([...warnings, ...result.warnings]))
    };
  }

  async testConnection(signal?: AbortSignal): Promise<{ success: boolean; user?: GitLabUser; error?: string }> {
    try {
      const user = await this.http.request<GitLabUser>('/user', 30_000, signal);
      this.currentUser = user;
      return { success: true, user };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async getUsers(search?: string, signal?: AbortSignal): Promise<GitLabUser[]> {
    const query = search?.trim();
    const userMap = new Map<number, GitLabUser>();
    let groupFailure: unknown;

    try {
      const groupUsers = await this.getGroupUsers(query, signal);
      groupUsers.forEach((user) => userMap.set(user.id, user));
    } catch (error) {
      if (isCancelled(error)) throw error;
      groupFailure = error;
    }

    if (query) {
      try {
        const directUsers = await this.http.requestAllPages<GitLabUser>(
          `/users?active=true&search=${encodeURIComponent(query)}`,
          10_000,
          signal,
          2
        );
        directUsers.forEach((user) => userMap.set(user.id, user));
      } catch (error) {
        if (isCancelled(error)) throw error;
        if (userMap.size === 0) throw groupFailure ?? error;
      }
    } else if (groupFailure) {
      throw groupFailure;
    }

    const normalizedQuery = query?.toLowerCase();
    return Array.from(userMap.values())
      .filter((user) => !normalizedQuery || user.name.toLowerCase().includes(normalizedQuery) || user.username.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 100);
  }

  private async getGroupUsers(search?: string, signal?: AbortSignal): Promise<GitLabUser[]> {
    let groups = await this.http.requestAllPages<GitLabGroup>(
      '/groups?membership=true&top_level_only=true',
      10_000,
      signal
    );
    if (groups.length === 0) {
      groups = await this.http.requestAllPages<GitLabGroup>('/groups?membership=true', 10_000, signal);
    }

    const results = await mapWithConcurrency(groups, 4, (group) => {
      const queryParam = search ? `?query=${encodeURIComponent(search)}` : '';
      return this.http.requestAllPages<GitLabUser>(
        `/groups/${group.id}/members/all${queryParam}`,
        15_000,
        signal
      );
    });
    const userMap = new Map<number, GitLabUser>();
    let firstFailure: unknown;

    results.forEach((result) => {
      if (result.status === 'rejected') {
        if (isCancelled(result.reason)) throw result.reason;
        firstFailure ??= result.reason;
        return;
      }
      result.value.forEach((user) => userMap.set(user.id, user));
    });

    if (groups.length > 0 && userMap.size === 0 && firstFailure) throw firstFailure;
    return Array.from(userMap.values());
  }
}
