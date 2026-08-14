import { createHash } from 'node:crypto';
import { access, mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { LocalFileChange, LocalReviewInput, ReviewRef } from '../contracts';
import type { CommandRunner } from './command';
import type { ReviewSource, SourceControlAdapter } from './sourceControl';
import { validatedReviewRef } from './validation';

const MAX_CHANGED_FILES = 500;
const MAX_FILE_DIFF_BYTES = 1_250_000;
const MAX_PROMPT_DIFF_BYTES = 600_000;

const exists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const safeProjectName = (path: string, remoteId: string) => {
  const leaf = basename(path).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
  const id = remoteId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40) || 'remote';
  return `${leaf}-${id}`;
};

const hostScope = (host: string) => createHash('sha256').update(host).digest('hex').slice(0, 12);

const canonicalRemote = (value: string) => {
  const remote = value.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  try {
    const url = new URL(remote);
    if (url.username || url.password) return '';
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    const scpLike = remote.match(/^([^@\s]+)@([^:\s]+):(.+)$/);
    return scpLike ? `${scpLike[1]}@${scpLike[2].toLowerCase()}:${scpLike[3]}` : remote;
  }
};

const remoteBelongsToSource = (remote: string, source: Pick<ReviewSource, 'cloneUrls'>) => {
  const canonical = canonicalRemote(remote);
  return Boolean(canonical) && source.cloneUrls.some((candidate) => canonicalRemote(candidate) === canonical);
};

const gitEnvironment = () => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never'
});

const parseNameStatus = (value: string): Array<Pick<LocalFileChange, 'path' | 'oldPath' | 'kind'>> => {
  const tokens = value.split('\0');
  const changes: Array<Pick<LocalFileChange, 'path' | 'oldPath' | 'kind'>> = [];
  let index = 0;
  while (index < tokens.length) {
    const status = tokens[index++];
    if (!status) continue;
    const code = status[0];
    if (code === 'R' || code === 'C') {
      const oldPath = tokens[index++] ?? '';
      const path = tokens[index++] ?? '';
      if (path) changes.push({ path, ...(oldPath && oldPath !== path ? { oldPath } : {}), kind: 'renamed' });
      continue;
    }
    const path = tokens[index++] ?? '';
    if (!path) continue;
    changes.push({
      path,
      kind: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified'
    });
  }
  return changes;
};

const diffCounts = (diff: string) => {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
};

const mapConcurrent = async <T, R>(values: T[], limit: number, mapper: (value: T, index: number) => Promise<R>) => {
  const result = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      result[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return result;
};

export type PreparedWorkspace = {
  input: LocalReviewInput;
  source: ReviewSource;
  promptDiff: string;
  promptDiffTruncated: boolean;
};

export class WorkspaceManager {
  private readonly repositoriesRoot: string;
  private readonly worktreesRoot: string;
  private readonly prepared = new Map<string, PreparedWorkspace>();
  private readonly projectLocks = new Map<string, Promise<void>>();

  constructor(
    dataDirectory: string,
    private readonly runner: CommandRunner,
    private readonly sourceControls: {
      get(kind: ReviewRef['sourceControl']): Pick<SourceControlAdapter, 'getReviewSource' | 'cloneRepository' | 'fetchReviewRefs'>
    }
  ) {
    this.repositoriesRoot = join(dataDirectory, 'repositories');
    this.worktreesRoot = join(dataDirectory, 'worktrees');
  }

  private refKey(ref: ReviewRef) {
    return ref.sourceControl === 'gitlab'
      ? `gitlab:${ref.host}:${ref.projectId}:${ref.number}`
      : `github:${ref.host}:${ref.owner}/${ref.repository}:${ref.number}`;
  }

  private async git(args: string[], options: { cwd?: string; signal?: AbortSignal; timeoutMs?: number; maxOutputBytes?: number; allowTruncation?: boolean } = {}) {
    return this.runner.run('git', args, {
      ...options,
      env: gitEnvironment(),
      timeoutMs: options.timeoutMs ?? 120_000
    });
  }

  private async withProjectLock(key: string, action: () => Promise<void>) {
    const previous = this.projectLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.projectLocks.set(key, queued);
    await previous;
    try {
      await action();
    } finally {
      release();
      if (this.projectLocks.get(key) === queued) this.projectLocks.delete(key);
    }
  }

  private async ensureRepository(
    source: ReviewSource,
    adapter: Pick<SourceControlAdapter, 'cloneRepository'>,
    ref: ReviewRef,
    signal?: AbortSignal
  ) {
    const scope = hostScope(`${ref.sourceControl}:${ref.host}`);
    const projectName = safeProjectName(source.repository.pathWithNamespace, source.repository.remoteId);
    const repositoryPath = join(this.repositoriesRoot, scope, projectName);
    await this.withProjectLock(`${scope}:${source.repository.remoteId}`, async () => {
      if (await exists(join(repositoryPath, '.git'))) {
        const remote = await this.git(['-C', repositoryPath, 'remote', 'get-url', 'origin'], { signal, maxOutputBytes: 32_000 });
        if (!remoteBelongsToSource(remote.stdout, source)) {
          throw new Error('The managed repository cache points at a different Git remote. Remove it from ReviewFlow’s data directory before retrying.');
        }
        return;
      }
      if (await exists(repositoryPath)) {
        throw new Error('ReviewFlow found an incomplete managed repository. Move it aside before retrying so no local data is overwritten.');
      }
      await mkdir(join(this.repositoriesRoot, scope), { recursive: true });
      await adapter.cloneRepository(source, repositoryPath, signal);
    });
    return repositoryPath;
  }

  private async fetchReview(
    repositoryPath: string,
    source: ReviewSource,
    adapter: Pick<SourceControlAdapter, 'fetchReviewRefs'>,
    ref: ReviewRef,
    signal?: AbortSignal
  ) {
    const targetRef = `refs/reviewflow/${ref.sourceControl}-${ref.number}-target`;
    const headRef = `refs/reviewflow/${ref.sourceControl}-${ref.number}-head`;
    await adapter.fetchReviewRefs(repositoryPath, source, { targetRef, headRef }, signal);

    const [resolvedBase, resolvedHead] = await Promise.all([
      this.git(['-C', repositoryPath, 'rev-parse', '--verify', `${source.baseSha}^{commit}`], { signal, maxOutputBytes: 32_000 }),
      this.git(['-C', repositoryPath, 'rev-parse', '--verify', `${headRef}^{commit}`], { signal, maxOutputBytes: 32_000 })
    ]);
    if (resolvedBase.stdout.trim() !== source.baseSha) {
      throw new Error('The managed repository could not resolve the provider’s merge base exactly.');
    }
    if (resolvedHead.stdout.trim() !== source.headSha) {
      throw new Error('The fetched review ref does not match the provider’s current head commit. Refresh the review queue and try again.');
    }
    return { headRef };
  }

  private async ensureWorktree(repositoryPath: string, source: ReviewSource, ref: ReviewRef, headRef: string, signal?: AbortSignal) {
    const scope = hostScope(`${ref.sourceControl}:${ref.host}`);
    const projectName = safeProjectName(source.repository.pathWithNamespace, source.repository.remoteId);
    const shortHead = source.headSha.slice(0, 12);
    const root = join(this.worktreesRoot, scope, projectName, `review-${ref.number}`);
    let worktreePath = join(root, shortHead);
    await mkdir(root, { recursive: true });

    if (await exists(join(worktreePath, '.git'))) {
      const currentHead = await this.git(['-C', worktreePath, 'rev-parse', 'HEAD'], { signal, maxOutputBytes: 32_000 });
      if (currentHead.stdout.trim() === source.headSha) return worktreePath;
      throw new Error('An existing managed worktree has an unexpected commit. ReviewFlow will not overwrite it.');
    }
    if (await exists(worktreePath)) {
      let suffix = 2;
      while (await exists(`${worktreePath}-${suffix}`)) suffix += 1;
      worktreePath = `${worktreePath}-${suffix}`;
    }

    await this.git(['-C', repositoryPath, 'worktree', 'add', '--detach', worktreePath, headRef], {
      signal,
      timeoutMs: 5 * 60_000,
      maxOutputBytes: 2_000_000
    });
    const currentHead = await this.git(['-C', worktreePath, 'rev-parse', 'HEAD'], { signal, maxOutputBytes: 32_000 });
    if (currentHead.stdout.trim() !== source.headSha) {
      throw new Error('The new worktree does not match the merge request head commit.');
    }
    return worktreePath;
  }

  private async changedFiles(worktreePath: string, source: ReviewSource, signal?: AbortSignal) {
    const range = `${source.baseSha}...${source.headSha}`;
    const names = await this.git([
      '-C', worktreePath, 'diff', '--find-renames', '--name-status', '-z', range, '--'
    ], { signal, maxOutputBytes: 8 * 1024 * 1024 });
    const metadata = parseNameStatus(names.stdout);
    const selected = metadata.slice(0, MAX_CHANGED_FILES);
    const changes = await mapConcurrent(selected, 6, async (change): Promise<LocalFileChange> => {
      const result = await this.git([
        '-C', worktreePath,
        'diff', '--find-renames', '--no-ext-diff', '--unified=80', range, '--', change.path
      ], {
        signal,
        timeoutMs: 90_000,
        maxOutputBytes: MAX_FILE_DIFF_BYTES,
        allowTruncation: true
      });
      return {
        ...change,
        diff: result.stdout,
        diffTruncated: result.truncated,
        ...diffCounts(result.stdout)
      };
    });
    return { changes, omittedFiles: Math.max(metadata.length - changes.length, 0) };
  }

  async prepare(value: ReviewRef, signal?: AbortSignal): Promise<PreparedWorkspace> {
    const ref = validatedReviewRef(value);
    const adapter = this.sourceControls.get(ref.sourceControl);
    const source = await adapter.getReviewSource(ref, signal);
    const existing = this.prepared.get(this.refKey(ref));
    if (existing?.source.headSha === source.headSha && await exists(existing.input.worktreePath)) return existing;

    const repositoryPath = await this.ensureRepository(source, adapter, ref, signal);
    const { headRef } = await this.fetchReview(repositoryPath, source, adapter, ref, signal);
    const worktreePath = await this.ensureWorktree(repositoryPath, source, ref, headRef, signal);
    const { changes, omittedFiles } = await this.changedFiles(worktreePath, source, signal);
    if (!changes.length) throw new Error('The local review ref contains no changes against the provider’s merge base.');
    const promptDiffResult = await this.git([
      '-C', worktreePath,
      'diff', '--find-renames', '--no-ext-diff', '--unified=12', `${source.baseSha}...${source.headSha}`, '--'
    ], {
      signal,
      timeoutMs: 120_000,
      maxOutputBytes: MAX_PROMPT_DIFF_BYTES,
      allowTruncation: true
    });
    const input: LocalReviewInput = {
      key: `${this.refKey(ref)}:${source.headSha}`,
      review: source.review,
      repository: source.repository,
      worktreePath,
      baseSha: source.baseSha,
      headSha: source.headSha,
      changes,
      diffTruncated: omittedFiles > 0 || promptDiffResult.truncated || changes.some((change) => change.diffTruncated),
      preparedAt: new Date().toISOString()
    };
    const workspace: PreparedWorkspace = {
      input,
      source,
      promptDiff: promptDiffResult.stdout,
      promptDiffTruncated: promptDiffResult.truncated || omittedFiles > 0
    };
    this.prepared.set(this.refKey(ref), workspace);
    return workspace;
  }

  async get(value: ReviewRef, signal?: AbortSignal) {
    const ref = validatedReviewRef(value);
    return this.prepared.get(this.refKey(ref)) ?? this.prepare(ref, signal);
  }

  async worktreeFor(value: ReviewRef) {
    const ref = validatedReviewRef(value);
    const workspace = this.prepared.get(this.refKey(ref));
    if (!workspace || !(await exists(workspace.input.worktreePath))) {
      throw new Error('Prepare this review before revealing its worktree.');
    }
    const info = await stat(workspace.input.worktreePath);
    if (!info.isDirectory()) throw new Error('The managed worktree is unavailable.');
    return workspace.input.worktreePath;
  }
}

export const workspaceTestExports = { parseNameStatus, diffCounts, canonicalRemote, remoteBelongsToSource };
