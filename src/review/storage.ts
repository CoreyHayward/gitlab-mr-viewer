import type { AiProviderConfig, CachedSemanticReview, SavedReviewState, SemanticReviewWorkspaceData } from '@/review/types';

const AI_CONFIG_KEY = 'gitlab-mr-viewer:ai-config:v1';
const REVIEW_CACHE_PREFIX = 'gitlab-mr-viewer:semantic-review:v1:';
const MAX_REVIEW_CACHE_BYTES = 900_000;

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

const isAiProviderConfig = (value: unknown): value is AiProviderConfig => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiProviderConfig>;
  return Boolean(
    typeof candidate.apiKey === 'string' && candidate.apiKey.trim() &&
    typeof candidate.apiBaseUrl === 'string' && candidate.apiBaseUrl.trim() &&
    typeof candidate.model === 'string' && candidate.model.trim()
  );
};

export function readAiProviderConfig(): AiProviderConfig | null {
  const value = read<unknown>(AI_CONFIG_KEY);
  if (!isAiProviderConfig(value)) return null;
  return {
    apiKey: value.apiKey.trim(),
    apiBaseUrl: value.apiBaseUrl.trim().replace(/\/+$/, ''),
    model: value.model.trim()
  };
}

export function writeAiProviderConfig(config: AiProviderConfig): boolean {
  if (!isAiProviderConfig(config)) return false;
  return write(AI_CONFIG_KEY, {
    apiKey: config.apiKey.trim(),
    apiBaseUrl: config.apiBaseUrl.trim().replace(/\/+$/, ''),
    model: config.model.trim()
  });
}

export function clearAiProviderConfig() {
  remove(AI_CONFIG_KEY);
}

export function semanticReviewCacheKey(instanceUrl: string, projectId: number, iid: number) {
  return `${REVIEW_CACHE_PREFIX}${encodeURIComponent(`${instanceUrl.trim().replace(/\/$/, '').toLowerCase()}|${projectId}|${iid}`)}`;
}

const isSavedReviewState = (value: unknown): value is SavedReviewState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SavedReviewState>;
  return Boolean(candidate.statuses && typeof candidate.statuses === 'object' && candidate.notes && typeof candidate.notes === 'object');
};

const isCachedDiscussion = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { id?: unknown; notes?: unknown };
  return typeof candidate.id === 'string' && Array.isArray(candidate.notes) && candidate.notes.every((note) => Boolean(note && typeof note === 'object'));
};

const isWorkspace = (value: unknown): value is SemanticReviewWorkspaceData => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SemanticReviewWorkspaceData>;
  return Boolean(
    candidate.mergeRequest &&
    candidate.review &&
    Array.isArray(candidate.review.sections) &&
    candidate.delta &&
    candidate.ai &&
    (candidate.discussions === undefined || (Array.isArray(candidate.discussions) && candidate.discussions.every(isCachedDiscussion)))
  );
};

export function readSemanticReviewCache(key: string): CachedSemanticReview | null {
  const value = read<Partial<CachedSemanticReview>>(key);
  if (!value || !isWorkspace(value.workspace) || !isSavedReviewState(value.state) || typeof value.updatedAt !== 'number') return null;
  return { workspace: value.workspace, state: value.state, updatedAt: value.updatedAt };
}

export function writeSemanticReviewCache(
  key: string,
  workspace: SemanticReviewWorkspaceData,
  state: SavedReviewState
): boolean {
  if (!isWorkspace(workspace) || !isSavedReviewState(state)) return false;
  const value: CachedSemanticReview = { workspace, state, updatedAt: Date.now() };
  try {
    if (JSON.stringify(value).length > MAX_REVIEW_CACHE_BYTES) return false;
  } catch {
    return false;
  }
  return write(key, value);
}
