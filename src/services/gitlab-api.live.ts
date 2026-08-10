import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitLabService } from '@/services/gitlab';
import type { GitLabMergeRequest, GitLabProject } from '@/types/gitlab';

type RequestRecord = {
  pathname: string;
  startedAt: number;
  endedAt: number;
  elapsedMs: number;
};

type MergeRequestWithReferences = GitLabMergeRequest & {
  references?: { full?: string };
};

type PhaseMetrics = {
  elapsedMs: number;
  requests: number;
  authorQueries: number;
  projectQueries: number;
  approvalQueries: number;
  graphQlQueries: number;
  authorWallMs: number;
  projectWallMs: number;
  approvalWallMs: number;
  graphQlWallMs: number;
};

const wallTimeFor = (records: RequestRecord[], matches: (record: RequestRecord) => boolean) => {
  const matching = records.filter(matches);
  if (matching.length === 0) return 0;
  return Math.round(
    Math.max(...matching.map(({ endedAt }) => endedAt)) -
    Math.min(...matching.map(({ startedAt }) => startedAt))
  );
};

const measure = async <T>(records: RequestRecord[], task: () => Promise<T>) => {
  const firstRecord = records.length;
  const startedAt = performance.now();
  const value = await task();
  const phaseRecords = records.slice(firstRecord);
  const metrics: PhaseMetrics = {
    elapsedMs: Math.round(performance.now() - startedAt),
    requests: phaseRecords.length,
    authorQueries: phaseRecords.filter(({ pathname }) => pathname === '/api/v4/merge_requests').length,
    projectQueries: phaseRecords.filter(({ pathname }) => /^\/api\/v4\/projects\/\d+$/.test(pathname)).length,
    approvalQueries: phaseRecords.filter(({ pathname }) => /^\/api\/v4\/projects\/\d+\/merge_requests\/\d+\/approvals$/.test(pathname)).length,
    graphQlQueries: phaseRecords.filter(({ pathname }) => pathname === '/api/graphql').length,
    authorWallMs: wallTimeFor(phaseRecords, ({ pathname }) => pathname === '/api/v4/merge_requests'),
    projectWallMs: wallTimeFor(phaseRecords, ({ pathname }) => /^\/api\/v4\/projects\/\d+$/.test(pathname)),
    approvalWallMs: wallTimeFor(phaseRecords, ({ pathname }) => /^\/api\/v4\/projects\/\d+\/merge_requests\/\d+\/approvals$/.test(pathname)),
    graphQlWallMs: wallTimeFor(phaseRecords, ({ pathname }) => pathname === '/api/graphql')
  };
  return { value, metrics };
};

const loadAuthorPagesConcurrently = async (
  instanceUrl: string,
  token: string,
  authors: string[]
) => {
  const pages = await Promise.all(authors.map(async (author) => {
    const searchParams = new URLSearchParams({
      scope: 'all',
      state: 'opened',
      author_username: author,
      order_by: 'updated_at',
      sort: 'desc',
      per_page: '20',
      page: '1'
    });
    const response = await fetch(`${instanceUrl.replace(/\/+$/, '')}/api/v4/merge_requests?${searchParams.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`GitLab author query failed with status ${response.status}.`);
    return await response.json() as GitLabMergeRequest[];
  }));

  return Array.from(new Map(pages.flat().map((mergeRequest) => [mergeRequest.id, mergeRequest])).values());
};

const loadProjectsConcurrently = async (
  instanceUrl: string,
  token: string,
  projectIds: number[]
) => Promise.all(projectIds.map(async (projectId) => {
  const response = await fetch(`${instanceUrl.replace(/\/+$/, '')}/api/v4/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`GitLab project query failed with status ${response.status}.`);
  return await response.json() as GitLabProject;
}));

const projectPathFromReference = (mergeRequest: MergeRequestWithReferences) => {
  const fullReference = mergeRequest.references?.full;
  const separatorIndex = fullReference?.lastIndexOf('!') ?? -1;
  return separatorIndex > 0 ? fullReference!.slice(0, separatorIndex) : null;
};

const projectUrlFromMergeRequest = (mergeRequest: GitLabMergeRequest) => {
  const markerIndex = mergeRequest.web_url.indexOf('/-/merge_requests/');
  return markerIndex > 0 ? mergeRequest.web_url.slice(0, markerIndex) : null;
};

const normalizedDetails = (mergeRequests: GitLabMergeRequest[]) => mergeRequests
  .map((mergeRequest) => ({
    key: `${mergeRequest.project_id}:${mergeRequest.iid}`,
    approvalsRequired: mergeRequest.approval_status?.approvals_required,
    approvalsLeft: mergeRequest.approval_status?.approvals_left,
    approvedBy: mergeRequest.approval_status?.approved_by
      .map(({ user }) => user.username.toLowerCase())
      .sort(),
    projectName: mergeRequest.project?.name,
    projectPath: mergeRequest.project?.path_with_namespace,
    projectUrl: mergeRequest.project?.web_url,
    additions: mergeRequest.diff_stats?.additions,
    deletions: mergeRequest.diff_stats?.deletions,
    fileCount: mergeRequest.diff_stats?.file_count
  }))
  .sort((left, right) => left.key.localeCompare(right.key));

const compareWithoutLeakingValues = (
  oracle: ReturnType<typeof normalizedDetails>,
  candidate: ReturnType<typeof normalizedDetails>
) => {
  const differences: string[] = [];
  if (oracle.length !== candidate.length) differences.push('result count differs');

  for (let index = 0; index < Math.min(oracle.length, candidate.length); index += 1) {
    const expected = oracle[index];
    const actual = candidate[index];
    if (expected.key !== actual.key) differences.push(`identity differs at result ${index + 1}`);
    if (expected.approvalsRequired !== actual.approvalsRequired) differences.push(`required approvals differ at result ${index + 1}`);
    if (expected.approvalsLeft !== actual.approvalsLeft) differences.push(`remaining approvals differ at result ${index + 1}`);
    if (JSON.stringify(expected.approvedBy) !== JSON.stringify(actual.approvedBy)) differences.push(`approvers differ at result ${index + 1}`);
    if (expected.projectName !== actual.projectName) differences.push(`project names differ at result ${index + 1}`);
    if (expected.projectPath !== actual.projectPath) differences.push(`project paths differ at result ${index + 1}`);
    if (expected.projectUrl !== actual.projectUrl) differences.push(`project URLs differ at result ${index + 1}`);
    if (expected.additions !== actual.additions) differences.push(`additions differ at result ${index + 1}`);
    if (expected.deletions !== actual.deletions) differences.push(`deletions differ at result ${index + 1}`);
    if (expected.fileCount !== actual.fileCount) differences.push(`file counts differ at result ${index + 1}`);
  }

  return differences;
};

describe('live GitLab merge request API benchmark', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('matches the current detail data with fewer requests', { timeout: 180_000 }, async () => {
    const instanceUrl = process.env.GITLAB_BENCHMARK_URL?.trim();
    const token = process.env.GITLAB_BENCHMARK_TOKEN?.trim();
    expect(Boolean(instanceUrl), 'GITLAB_BENCHMARK_URL must be configured').toBe(true);
    expect(Boolean(token), 'GITLAB_BENCHMARK_TOKEN must be configured').toBe(true);

    const authors = process.env.GITLAB_BENCHMARK_AUTHORS
      ?.split(',')
      .map((author) => author.trim())
      .filter(Boolean) ?? [];
    expect(authors.length, 'GITLAB_BENCHMARK_AUTHORS must include at least one username').toBeGreaterThan(0);
    const nativeFetch = globalThis.fetch;
    const records: RequestRecord[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const startedAt = performance.now();
      try {
        return await nativeFetch(input, init);
      } finally {
        const endedAt = performance.now();
        records.push({
          pathname: new URL(input instanceof Request ? input.url : String(input)).pathname,
          startedAt,
          endedAt,
          elapsedMs: Math.round(endedAt - startedAt)
        });
      }
    });

    const discovery = await measure(records, () => new GitLabService(instanceUrl!, token!).getAllMergeRequests({
      state: 'opened',
      authors
    }));
    expect(discovery.value.warnings, 'MR discovery returned partial results').toEqual([]);
    expect(discovery.value.mergeRequests.length, 'The configured author filter returned no open MRs').toBeGreaterThan(0);
    expect(discovery.value.mergeRequests.every(({ project }) => Boolean(project?.path_with_namespace)), 'Some MRs lacked project metadata').toBe(true);

    const eightWayAuthors = await measure(records, () => loadAuthorPagesConcurrently(instanceUrl!, token!, authors));
    const discoveredIds = discovery.value.mergeRequests.map(({ id }) => id).sort((left, right) => left - right);
    const eightWayIds = eightWayAuthors.value.map(({ id }) => id).sort((left, right) => left - right);
    expect(eightWayIds.length, 'Eight-way author loading returned a different MR count').toBe(discoveredIds.length);
    expect(eightWayIds.every((id, index) => id === discoveredIds[index]), 'Eight-way author loading returned different MRs').toBe(true);
    const projectIds = Array.from(new Set(discovery.value.mergeRequests.map(({ project_id }) => project_id)));
    const projectOracle = await measure(records, () => loadProjectsConcurrently(instanceUrl!, token!, projectIds));
    const projectsById = new Map(projectOracle.value.map((project) => [project.id, project]));
    const referenceDifferences = eightWayAuthors.value.flatMap((mergeRequest, index) => {
      const project = projectsById.get(mergeRequest.project_id);
      if (!project) return [`project metadata missing at result ${index + 1}`];
      const differences: string[] = [];
      if (projectPathFromReference(mergeRequest) !== project.path_with_namespace) {
        differences.push(`project reference differs at result ${index + 1}`);
      }
      if (projectUrlFromMergeRequest(mergeRequest) !== project.web_url) {
        differences.push(`project URL differs at result ${index + 1}`);
      }
      return differences;
    });
    expect(referenceDifferences, 'MR references did not reproduce authoritative project metadata').toEqual([]);

    const approvalWarnings: string[] = [];
    const diffWarnings: string[] = [];
    const oracleService = new GitLabService(instanceUrl!, token!);
    const oracle = await measure(records, async () => {
      const [approvals, diffStats] = await Promise.all([
        oracleService.enrichMergeRequestsWithApprovalStatus(discovery.value.mergeRequests, undefined, true, approvalWarnings),
        oracleService.enrichMergeRequestsWithDiffStats(discovery.value.mergeRequests, undefined, true, diffWarnings)
      ]);
      const approvalsById = new Map(approvals.map((mergeRequest) => [mergeRequest.id, mergeRequest.approval_status]));
      const diffStatsById = new Map(diffStats.map((mergeRequest) => [mergeRequest.id, mergeRequest.diff_stats]));
      return discovery.value.mergeRequests.map((mergeRequest) => ({
        ...mergeRequest,
        project: projectsById.get(mergeRequest.project_id),
        approval_status: approvalsById.get(mergeRequest.id),
        diff_stats: diffStatsById.get(mergeRequest.id)
      }));
    });
    expect(approvalWarnings.length, 'The REST approval oracle returned warnings').toBe(0);
    expect(diffWarnings.length, 'The current diff-stat oracle returned warnings').toBe(0);

    const candidateWarnings: string[] = [];
    const candidate = await measure(records, () => new GitLabService(instanceUrl!, token!).enrichMergeRequestsWithDetails(
      discovery.value.mergeRequests,
      undefined,
      true,
      candidateWarnings
    ));
    expect(candidateWarnings.length, 'The combined GraphQL candidate returned warnings').toBe(0);

    const differences = compareWithoutLeakingValues(
      normalizedDetails(oracle.value),
      normalizedDetails(candidate.value)
    );
    expect(differences, 'Combined GraphQL data did not match the current API responses').toEqual([]);
    expect(candidate.metrics.requests, 'The combined candidate did not reduce detail request count').toBeLessThan(oracle.metrics.requests);

    const projectCount = new Set(discovery.value.mergeRequests.map(({ project_id }) => project_id)).size;
    process.stdout.write(`\n${JSON.stringify({
      gitLabApiBenchmark: {
        mergeRequests: discovery.value.mergeRequests.length,
        projects: projectCount,
        discovery: discovery.metrics,
        eightWayAuthorQueries: eightWayAuthors.metrics,
        currentProjectHydration: projectOracle.metrics,
        currentDetails: oracle.metrics,
        combinedDetails: candidate.metrics,
        detailRequestReduction: projectOracle.metrics.requests + oracle.metrics.requests - candidate.metrics.requests
      }
    }, null, 2)}\n`);
  });
});
