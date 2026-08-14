import type {
  DashboardView,
  DesktopReview,
  ExecutableStatus,
  ReviewDashboard,
  ReviewPerson,
  ReviewRef
} from '../contracts';
import type { CommandRunner } from './command';
import { CommandError } from './command';
import { ExecutableResolver } from './executables';
import type { ManagedReviewRefs, ReviewSource, SourceControlAdapter } from './sourceControl';
import { validatedDashboardView, validatedHost, validatedReviewRef } from './validation';

type GitLabUserRaw = {
  id?: unknown;
  name?: unknown;
  username?: unknown;
  avatar_url?: unknown;
};

type GitLabProjectRaw = {
  id?: unknown;
  name?: unknown;
  path_with_namespace?: unknown;
  web_url?: unknown;
  ssh_url_to_repo?: unknown;
  http_url_to_repo?: unknown;
  default_branch?: unknown;
};

type GitLabMergeRequestRaw = {
  id?: unknown;
  iid?: unknown;
  project_id?: unknown;
  title?: unknown;
  description?: unknown;
  web_url?: unknown;
  author?: GitLabUserRaw;
  reviewers?: GitLabUserRaw[];
  assignees?: GitLabUserRaw[];
  source_branch?: unknown;
  target_branch?: unknown;
  sha?: unknown;
  draft?: unknown;
  work_in_progress?: unknown;
  detailed_merge_status?: unknown;
  merge_status?: unknown;
  blocking_discussions_resolved?: unknown;
  labels?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  changes_count?: unknown;
  references?: { full?: unknown };
  head_pipeline?: { status?: unknown } | null;
  diff_refs?: {
    base_sha?: unknown;
    start_sha?: unknown;
    head_sha?: unknown;
  };
};

const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const integer = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};
const stringArray = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : [];

const personFrom = (value: GitLabUserRaw | undefined): ReviewPerson => ({
  id: integer(value?.id),
  name: text(value?.name, text(value?.username, 'GitLab user')),
  username: text(value?.username, 'unknown'),
  ...(text(value?.avatar_url) ? { avatarUrl: text(value?.avatar_url) } : {})
});

const projectPathFrom = (mergeRequest: GitLabMergeRequestRaw) => {
  const fullReference = text(mergeRequest.references?.full);
  const marker = `!${integer(mergeRequest.iid)}`;
  if (fullReference.endsWith(marker)) return fullReference.slice(0, -marker.length);

  const webUrl = text(mergeRequest.web_url);
  try {
    const path = new URL(webUrl).pathname;
    const suffix = `/-/merge_requests/${integer(mergeRequest.iid)}`;
    if (path.endsWith(suffix)) return decodeURIComponent(path.slice(1, -suffix.length));
  } catch {
    // Fall through to the stable project identifier.
  }
  return `project-${integer(mergeRequest.project_id)}`;
};

const readinessFrom = (mergeRequest: GitLabMergeRequestRaw) => {
  if (mergeRequest.draft === true || mergeRequest.work_in_progress === true) {
    return { readiness: 'draft' as const, readinessLabel: 'Draft' };
  }
  if (mergeRequest.blocking_discussions_resolved === false) {
    return { readiness: 'blocked' as const, readinessLabel: 'Unresolved threads' };
  }

  const status = text(mergeRequest.detailed_merge_status, text(mergeRequest.merge_status)).toLowerCase();
  if (['checking', 'preparing', 'unchecked', 'rechecking'].includes(status)) {
    return { readiness: 'checking' as const, readinessLabel: 'GitLab checking' };
  }
  if (['conflict', 'broken_status', 'ci_must_pass', 'discussions_not_resolved', 'jira_association_missing'].includes(status)) {
    return { readiness: 'blocked' as const, readinessLabel: status === 'conflict' ? 'Has conflicts' : 'Merge blocked' };
  }
  return { readiness: 'ready' as const, readinessLabel: 'Ready for review' };
};

const repositoryWebUrlFrom = (raw: GitLabMergeRequestRaw, projectPath: string, host: string) => {
  const reviewUrl = text(raw.web_url);
  const suffix = `/-/merge_requests/${integer(raw.iid)}`;
  return reviewUrl.endsWith(suffix) ? reviewUrl.slice(0, -suffix.length) : `https://${host}/${projectPath}`;
};

export const reviewFrom = (raw: GitLabMergeRequestRaw, host: string): DesktopReview => {
  const readiness = readinessFrom(raw);
  const changesCount = integer(raw.changes_count);
  const projectId = integer(raw.project_id);
  const number = integer(raw.iid);
  const projectPath = projectPathFrom(raw);
  return {
    ref: { sourceControl: 'gitlab', host, projectId, number },
    id: `gitlab:${integer(raw.id)}`,
    number,
    numberLabel: `!${number}`,
    repository: {
      sourceControl: 'gitlab',
      remoteId: String(projectId),
      name: projectPath.split('/').at(-1) ?? projectPath,
      pathWithNamespace: projectPath,
      webUrl: repositoryWebUrlFrom(raw, projectPath, host)
    },
    title: text(raw.title, `Merge request !${number}`),
    description: text(raw.description),
    webUrl: text(raw.web_url),
    author: personFrom(raw.author),
    reviewers: Array.isArray(raw.reviewers) ? raw.reviewers.map(personFrom) : [],
    assignees: Array.isArray(raw.assignees) ? raw.assignees.map(personFrom) : [],
    sourceBranch: text(raw.source_branch),
    targetBranch: text(raw.target_branch),
    headSha: text(raw.diff_refs?.head_sha, text(raw.sha)),
    draft: readiness.readiness === 'draft',
    ...readiness,
    ...(text(raw.head_pipeline?.status) ? { pipelineStatus: text(raw.head_pipeline?.status) } : {}),
    ...(typeof raw.blocking_discussions_resolved === 'boolean'
      ? { blockingDiscussionsResolved: raw.blocking_discussions_resolved }
      : {}),
    labels: stringArray(raw.labels),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
    ...(changesCount ? { changesCount } : {})
  };
};

const dashboardQueryFor = (view: DashboardView, userId: number) => {
  const params = new URLSearchParams({
    state: 'opened',
    scope: 'all',
    order_by: 'updated_at',
    sort: 'desc',
    per_page: '100'
  });
  if (view === 'review-requested') params.set('reviewer_id', String(userId));
  if (view === 'assigned') params.set('assignee_id', String(userId));
  if (view === 'authored') params.set('author_id', String(userId));
  return `/merge_requests?${params.toString()}`;
};

const parseJson = <T,>(value: string, label: string): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} returned data ReviewFlow could not understand.`);
  }
};

const parseNdjson = <T,>(value: string): T[] => {
  const records: T[] = [];
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = parseJson<T | T[]>(line, 'GitLab');
    if (Array.isArray(parsed)) records.push(...parsed);
    else records.push(parsed);
  }
  return records;
};

const nonInteractiveEnvironment = (host: string) => ({
  ...process.env,
  GITLAB_HOST: host,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  SSH_ASKPASS_REQUIRE: 'never'
});

const shellWord = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const authenticatedGitEnvironment = (host: string, credentialHelper: string) => ({
  ...nonInteractiveEnvironment(host),
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: `credential.https://${host}.helper`,
  GIT_CONFIG_VALUE_0: credentialHelper,
  GIT_CONFIG_KEY_1: `credential.http://${host}.helper`,
  GIT_CONFIG_VALUE_1: credentialHelper
});

export class GlabClient implements SourceControlAdapter {
  readonly kind = 'gitlab' as const;
  readonly label = 'GitLab';

  constructor(
    private readonly runner: CommandRunner,
    private readonly resolver: Pick<ExecutableResolver, 'find'> = new ExecutableResolver()
  ) {}

  private async executable() {
    const executable = await this.resolver.find('glab');
    if (!executable) throw new Error('Install the GitLab CLI (`glab`) and authenticate it before using the desktop dashboard.');
    return executable;
  }

  private async api<T>(hostValue: string, endpoint: string, signal?: AbortSignal): Promise<T> {
    const host = validatedHost(hostValue);
    const result = await this.runner.run(await this.executable(), [
      'api', endpoint, '--hostname', host, '--output', 'json'
    ], { signal, timeoutMs: 60_000, maxOutputBytes: 24 * 1024 * 1024 });
    return parseJson<T>(result.stdout, 'GitLab');
  }

  private async apiAll<T>(hostValue: string, endpoint: string, signal?: AbortSignal): Promise<T[]> {
    const host = validatedHost(hostValue);
    const result = await this.runner.run(await this.executable(), [
      'api', endpoint, '--hostname', host, '--paginate', '--output', 'ndjson'
    ], { signal, timeoutMs: 120_000, maxOutputBytes: 48 * 1024 * 1024 });
    return parseNdjson<T>(result.stdout);
  }

  async status(): Promise<ExecutableStatus> {
    const executable = await this.resolver.find('glab');
    if (!executable) return { installed: false, error: 'GitLab CLI not found.' };
    try {
      const result = await this.runner.run(executable, ['--version'], { timeoutMs: 5_000, maxOutputBytes: 16_000 });
      return { installed: true, path: executable, version: result.stdout.trim().split(/\r?\n/)[0] };
    } catch (error) {
      return {
        installed: true,
        path: executable,
        error: error instanceof Error ? error.message : 'Could not inspect glab.'
      };
    }
  }

  async cloneRepository(source: ReviewSource, destination: string, signal?: AbortSignal): Promise<void> {
    const ref = validatedReviewRef(source.review.ref);
    if (ref.sourceControl !== 'gitlab') throw new Error('The GitLab adapter cannot clone a repository from another provider.');
    const executable = await this.executable();
    const credentialHelper = `!${shellWord(executable)} auth git-credential`;
    await this.runner.run(executable, [
      'repo', 'clone', source.repository.webUrl, destination,
      '--', '--filter=blob:none', '--no-checkout', '--origin', 'origin'
    ], {
      env: authenticatedGitEnvironment(ref.host, credentialHelper),
      signal,
      timeoutMs: 5 * 60_000,
      maxOutputBytes: 2_000_000
    });
  }

  async fetchReviewRefs(
    repositoryPath: string,
    source: ReviewSource,
    refs: ManagedReviewRefs,
    signal?: AbortSignal
  ): Promise<void> {
    const ref = validatedReviewRef(source.review.ref);
    if (ref.sourceControl !== 'gitlab') throw new Error('The GitLab adapter cannot fetch a review from another provider.');
    const credentialHelper = `!${shellWord(await this.executable())} auth git-credential`;
    await this.runner.run('git', [
      '-c', `credential.https://${ref.host}.helper=${credentialHelper}`,
      '-c', `credential.http://${ref.host}.helper=${credentialHelper}`,
      '-C', repositoryPath,
      'fetch', '--no-tags', '--prune', 'origin',
      `+${source.targetRemoteRef}:${refs.targetRef}`,
      `+${source.headRemoteRef}:${refs.headRef}`
    ], {
      env: nonInteractiveEnvironment(ref.host),
      signal,
      timeoutMs: 5 * 60_000,
      maxOutputBytes: 2_000_000
    });
  }

  async listReviews(hostValue: string, viewValue: DashboardView, signal?: AbortSignal): Promise<ReviewDashboard> {
    const host = validatedHost(hostValue);
    const view = validatedDashboardView(viewValue);
    try {
      const userRaw = await this.api<GitLabUserRaw>(host, '/user', signal);
      const currentUser = personFrom(userRaw);
      if (!currentUser.id) throw new Error('GitLab did not return the current user.');
      const rawMergeRequests = await this.apiAll<GitLabMergeRequestRaw>(host, dashboardQueryFor(view, currentUser.id), signal);
      return {
        sourceControl: 'gitlab',
        host,
        currentUser,
        reviews: rawMergeRequests.map((raw) => reviewFrom(raw, host)).filter((review) => review.number && review.ref.sourceControl === 'gitlab' && review.ref.projectId),
        fetchedAt: new Date().toISOString()
      };
    } catch (error) {
      if (error instanceof CommandError && /401|403|authenticate|token/i.test(`${error.message} ${error.stderr}`)) {
        throw new Error(`glab is not authenticated for ${host}. Run \`glab auth login --hostname ${host}\` and try again.`);
      }
      throw error;
    }
  }

  async getReviewSource(value: ReviewRef, signal?: AbortSignal): Promise<ReviewSource> {
    const ref = validatedReviewRef(value);
    if (ref.sourceControl !== 'gitlab') throw new Error('The GitLab adapter cannot load a review from another provider.');
    const [rawMergeRequest, rawProject] = await Promise.all([
      this.api<GitLabMergeRequestRaw>(ref.host, `/projects/${ref.projectId}/merge_requests/${ref.number}`, signal),
      this.api<GitLabProjectRaw>(ref.host, `/projects/${ref.projectId}`, signal)
    ]);
    const review = reviewFrom(rawMergeRequest, ref.host);
    const projectPath = text(rawProject.path_with_namespace, review.repository.pathWithNamespace);
    const webUrl = text(rawProject.web_url, `https://${ref.host}/${projectPath}`);
    const cloneUrls = [text(rawProject.ssh_url_to_repo), text(rawProject.http_url_to_repo)].filter(Boolean);
    const baseSha = text(rawMergeRequest.diff_refs?.base_sha);
    const headSha = text(rawMergeRequest.diff_refs?.head_sha, text(rawMergeRequest.sha));
    if (!cloneUrls.length) throw new Error('GitLab did not provide a clone URL for this project.');
    if (!baseSha || !headSha) throw new Error('GitLab did not provide the merge request diff references.');
    return {
      review: {
        ...review,
        headSha,
        repository: {
          sourceControl: 'gitlab',
          remoteId: String(ref.projectId),
          name: text(rawProject.name, projectPath.split('/').at(-1) ?? projectPath),
          pathWithNamespace: projectPath,
          webUrl
        }
      },
      repository: {
        sourceControl: 'gitlab',
        remoteId: String(ref.projectId),
        name: text(rawProject.name, projectPath.split('/').at(-1) ?? projectPath),
        pathWithNamespace: projectPath,
        webUrl
      },
      cloneUrls,
      sourceBranch: text(rawMergeRequest.source_branch),
      targetBranch: text(rawMergeRequest.target_branch, text(rawProject.default_branch, 'main')),
      baseSha,
      startSha: text(rawMergeRequest.diff_refs?.start_sha, baseSha),
      headSha,
      targetRemoteRef: `refs/heads/${text(rawMergeRequest.target_branch, text(rawProject.default_branch, 'main'))}`,
      headRemoteRef: `refs/merge-requests/${ref.number}/head`
    };
  }
}
