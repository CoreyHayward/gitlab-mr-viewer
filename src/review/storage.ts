import type { AiProviderConfig, CachedSemanticReview, ReviewFileChange, SavedReviewState, SemanticReviewWorkspaceData } from '@/review/types';
import { buildAiProviderConfig } from '@/utils/connectionConfig';

const AI_CONFIG_KEY = 'gitlab-mr-viewer:ai-config:v1';
const REVIEW_CACHE_PREFIX = 'gitlab-mr-viewer:semantic-review:v2:';
const LEGACY_REVIEW_CACHE_PREFIX = 'gitlab-mr-viewer:semantic-review:v1:';
const MAX_REVIEW_WORKSPACE_BYTES = 4_000_000;
const workspaceFingerprints = new Map<string, string>();

const read = <T,>(key: string): T | null => {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const remove = (key: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Browser storage is optional; the active review continues in memory.
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(
  value && typeof value === 'object' && !Array.isArray(value)
);

const aiProviderConfigFrom = (value: unknown): AiProviderConfig | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AiProviderConfig>;
  if (
    typeof candidate.apiKey !== 'string' ||
    typeof candidate.apiBaseUrl !== 'string' ||
    typeof candidate.model !== 'string'
  ) return null;
  return buildAiProviderConfig(true, candidate.apiKey, candidate.model, candidate.apiBaseUrl).config;
};

export function readAiProviderConfig(): AiProviderConfig | null {
  return aiProviderConfigFrom(read<unknown>(AI_CONFIG_KEY));
}

export function writeAiProviderConfig(config: AiProviderConfig): boolean {
  const normalized = aiProviderConfigFrom(config);
  return normalized ? write(AI_CONFIG_KEY, normalized) : false;
}

export function clearAiProviderConfig() {
  remove(AI_CONFIG_KEY);
}

const normalizedInstance = (instanceUrl: string) => instanceUrl.trim().replace(/\/+$/, '').toLowerCase();

export function reviewInputSignature(input: {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  baseSha?: string;
  startSha?: string;
  headSha: string;
  changes: ReviewFileChange[];
}) {
  return JSON.stringify({
    ...input,
    changes: input.changes.map((change) => ({
      path: change.path,
      oldPath: change.oldPath,
      kind: change.kind,
      diffLength: change.diff.length,
      diffStart: change.diff.slice(0, 64),
      diffEnd: change.diff.slice(-64)
    }))
  });
}

export function semanticReviewCacheKey(instanceUrl: string, userId: number | null, projectId: number, iid: number) {
  const userScope = Number.isSafeInteger(userId) && Number(userId) > 0 ? String(userId) : 'unknown-user';
  return `${REVIEW_CACHE_PREFIX}${encodeURIComponent(`${normalizedInstance(instanceUrl)}|${userScope}|${projectId}|${iid}`)}`;
}

export function legacySemanticReviewCacheKey(instanceUrl: string, projectId: number, iid: number) {
  return `${LEGACY_REVIEW_CACHE_PREFIX}${encodeURIComponent(`${normalizedInstance(instanceUrl)}|${projectId}|${iid}`)}`;
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';
const isNonNegativeNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isReviewFileChange = (value: unknown): value is ReviewFileChange => {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === 'string' &&
    typeof value.diff === 'string' &&
    ['added', 'modified', 'deleted', 'renamed'].includes(String(value.kind)) &&
    isOptionalString(value.oldPath) &&
    isOptionalString(value.explanation)
  );
};

const isSemanticSection = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.intent === 'string' &&
    typeof value.reviewFocus === 'string' &&
    ['low', 'medium', 'high'].includes(String(value.risk)) &&
    isStringArray(value.filePaths) &&
    Array.isArray(value.files) && value.files.every(isReviewFileChange) &&
    isStringArray(value.relatedSectionIds) &&
    isStringArray(value.prompts)
  );
};

const isSavedReviewState = (value: unknown): value is SavedReviewState => {
  if (!isRecord(value) || !isRecord(value.statuses) || !isRecord(value.notes)) return false;
  const validStatuses = ['not-started', 'in-progress', 'reviewed', 'needs-look', 'blocked', 'stale'];
  return (
    Object.values(value.statuses).every((status) => typeof status === 'string' && validStatuses.includes(status)) &&
    Object.values(value.notes).every((note) => typeof note === 'string') &&
    isOptionalString(value.selectedSectionId)
  );
};

const isCachedDiscussionNote = (value: unknown) => {
  if (!isRecord(value)) return false;
  const authorValid = value.author === null || (
    isRecord(value.author) && typeof value.author.name === 'string' && typeof value.author.username === 'string'
  );
  return (
    typeof value.id === 'number' &&
    typeof value.body === 'string' &&
    typeof value.created_at === 'string' &&
    authorValid &&
    (value.resolved === undefined || typeof value.resolved === 'boolean') &&
    (value.system === undefined || typeof value.system === 'boolean') &&
    (value.position === undefined || value.position === null || isRecord(value.position))
  );
};

const isCachedDiscussion = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && Array.isArray(value.notes) && value.notes.every(isCachedDiscussionNote);
};

const isMergeRequestMetadata = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeNumber(value.projectId) &&
    typeof value.projectPath === 'string' &&
    isNonNegativeNumber(value.iid) &&
    typeof value.title === 'string' &&
    typeof value.author === 'string' &&
    typeof value.sourceBranch === 'string' &&
    typeof value.targetBranch === 'string' &&
    typeof value.headSha === 'string' &&
    isNonNegativeNumber(value.changedFiles) &&
    isOptionalString(value.webUrl) &&
    isOptionalString(value.baseSha) &&
    isOptionalString(value.startSha) &&
    isOptionalString(value.reviewInputSignature)
  );
};

const isDiffCompleteness = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    typeof value.complete === 'boolean' &&
    typeof value.truncated === 'boolean' &&
    isNonNegativeNumber(value.loaded_files) &&
    isNonNegativeNumber(value.collapsed_files) &&
    isNonNegativeNumber(value.too_large_files) &&
    isNonNegativeNumber(value.generated_files) &&
    (value.total_files === undefined || isNonNegativeNumber(value.total_files)) &&
    isOptionalString(value.reason)
  );
};

const isWorkspace = (value: unknown): value is SemanticReviewWorkspaceData => {
  if (!isRecord(value) || !isRecord(value.review) || !isRecord(value.review.overview)) return false;
  const overview = value.review.overview;
  const delta = value.delta;
  const ai = value.ai;
  return Boolean(
    isMergeRequestMetadata(value.mergeRequest) &&
    typeof overview.purpose === 'string' &&
    typeof overview.scope === 'string' &&
    typeof overview.riskSummary === 'string' &&
    isStringArray(overview.areas) &&
    Array.isArray(value.review.sections) && value.review.sections.every(isSemanticSection) &&
    isRecord(delta) && ['first-review', 'unchanged', 'updated'].includes(String(delta.state)) &&
    isStringArray(delta.summary) && isStringArray(delta.changedPaths) && isStringArray(delta.newPaths) &&
    isRecord(ai) && typeof ai.configured === 'boolean' && typeof ai.used === 'boolean' &&
    typeof value.truncated === 'boolean' &&
    (value.diffCompleteness === undefined || isDiffCompleteness(value.diffCompleteness)) &&
    (value.discussions === undefined || (Array.isArray(value.discussions) && value.discussions.every(isCachedDiscussion)))
  );
};

const validCache = (value: Partial<CachedSemanticReview> | null): CachedSemanticReview | null => {
  if (!value || !isWorkspace(value.workspace) || !isSavedReviewState(value.state) || typeof value.updatedAt !== 'number') return null;
  return { workspace: value.workspace, state: value.state, updatedAt: value.updatedAt };
};

const workspaceFingerprint = (workspace: SemanticReviewWorkspaceData) => JSON.stringify({
  mergeRequest: workspace.mergeRequest,
  review: {
    overview: workspace.review.overview,
    sections: workspace.review.sections.map((section) => ({
      id: section.id,
      title: section.title,
      intent: section.intent,
      reviewFocus: section.reviewFocus,
      risk: section.risk,
      filePaths: section.filePaths,
      relatedSectionIds: section.relatedSectionIds,
      prompts: section.prompts,
      files: section.files.map((file) => ({
        path: file.path,
        oldPath: file.oldPath,
        kind: file.kind,
        explanation: file.explanation,
        diffLength: file.diff.length,
        diffStart: file.diff.slice(0, 64),
        diffEnd: file.diff.slice(-64)
      }))
    }))
  },
  delta: workspace.delta,
  ai: workspace.ai,
  truncated: workspace.truncated,
  diffCompleteness: workspace.diffCompleteness,
  discussions: (workspace.discussions ?? []).map((discussion) => ({
    id: discussion.id,
    notes: discussion.notes.map((note) => [note.id, note.updated_at, note.resolved])
  }))
});

const readSplitCache = (key: string): CachedSemanticReview | null => {
  const workspace = read<unknown>(`${key}:workspace`);
  const stateValue = read<{ state?: unknown; updatedAt?: unknown }>(`${key}:state`);
  return validCache({
    workspace: workspace as SemanticReviewWorkspaceData,
    state: stateValue?.state as SavedReviewState,
    updatedAt: stateValue?.updatedAt as number
  });
};

export function readSemanticReviewCache(key: string, legacyKey?: string): CachedSemanticReview | null {
  const current = readSplitCache(key) ?? validCache(read<Partial<CachedSemanticReview>>(key));
  if (current) {
    workspaceFingerprints.set(key, workspaceFingerprint(current.workspace));
    return current;
  }

  const legacy = legacyKey ? validCache(read<Partial<CachedSemanticReview>>(legacyKey)) : null;
  if (!legacy) return null;
  if (writeSemanticReviewCache(key, legacy.workspace, legacy.state)) remove(legacyKey!);
  return legacy;
}

export function writeSemanticReviewCache(
  key: string,
  workspace: SemanticReviewWorkspaceData,
  state: SavedReviewState
): boolean {
  if (!isWorkspace(workspace) || !isSavedReviewState(state)) return false;
  const updatedAt = Date.now();
  const fingerprint = workspaceFingerprint(workspace);
  if (workspaceFingerprints.get(key) === fingerprint) {
    return write(`${key}:state`, { state, updatedAt });
  }

  let serializedWorkspace: string;
  try {
    serializedWorkspace = JSON.stringify(workspace);
    if (serializedWorkspace.length > MAX_REVIEW_WORKSPACE_BYTES) return false;
  } catch {
    return false;
  }
  const workspaceSaved = write(`${key}:workspace`, workspace);
  if (!workspaceSaved) return false;
  workspaceFingerprints.set(key, fingerprint);
  return write(`${key}:state`, { state, updatedAt });
}
