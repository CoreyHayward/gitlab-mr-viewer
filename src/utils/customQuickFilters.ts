export const MAX_CUSTOM_QUICK_FILTERS = 30;
export const MAX_CUSTOM_QUICK_FILTER_NAME_LENGTH = 80;
export const MAX_CUSTOM_QUICK_FILTER_URL_LENGTH = 12_000;

const CUSTOM_QUICK_FILTERS_STORAGE_PREFIX = 'gitlab-mr-viewer:custom-quick-filters:v1:';

export interface CustomQuickFilter {
  id: string;
  name: string;
  url: string;
  createdAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(
  value && typeof value === 'object' && !Array.isArray(value)
);

const normalizeScope = (scope: string) => scope.trim();

export const customQuickFiltersStorageKey = (scope: string) => (
  `${CUSTOM_QUICK_FILTERS_STORAGE_PREFIX}${encodeURIComponent(normalizeScope(scope))}`
);

const normalizeName = (name: string) => {
  const normalized = name.trim().slice(0, MAX_CUSTOM_QUICK_FILTER_NAME_LENGTH);
  return normalized || null;
};

const normalizeURL = (url: string) => {
  if (typeof url !== 'string' || url.length > MAX_CUSTOM_QUICK_FILTER_URL_LENGTH) return null;

  const normalized = url.trim();
  const isQueryString = normalized === '' || normalized.startsWith('?');
  const isHttpURL = /^https?:\/\//i.test(normalized);
  if (!isQueryString && !isHttpURL) return null;

  try {
    const parsed = new URL(normalized, 'https://reviewflow.local');
    return parsed.search.slice(0, MAX_CUSTOM_QUICK_FILTER_URL_LENGTH);
  } catch {
    return null;
  }
};

const customQuickFilterFrom = (value: unknown): CustomQuickFilter | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || typeof value.url !== 'string') {
    return null;
  }

  const name = normalizeName(value.name);
  const url = normalizeURL(value.url);
  const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
    ? value.createdAt
    : null;
  if (!name || url === null || createdAt === null) return null;

  return { id: value.id, name, url, createdAt };
};

const readStorage = (scope: string): CustomQuickFilter[] => {
  if (typeof window === 'undefined' || !normalizeScope(scope)) return [];

  try {
    const raw = window.localStorage.getItem(customQuickFiltersStorageKey(scope));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      const filter = customQuickFilterFrom(value);
      return filter ? [filter] : [];
    }).slice(0, MAX_CUSTOM_QUICK_FILTERS);
  } catch {
    return [];
  }
};

const writeStorage = (scope: string, filters: CustomQuickFilter[]) => {
  if (typeof window === 'undefined' || !normalizeScope(scope)) return false;

  try {
    window.localStorage.setItem(
      customQuickFiltersStorageKey(scope),
      JSON.stringify(filters.slice(0, MAX_CUSTOM_QUICK_FILTERS))
    );
    return true;
  } catch {
    return false;
  }
};

const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const getCurrentFilterURL = (): string => {
  if (typeof window === 'undefined') return '';
  return window.location.search;
};

export const loadCustomQuickFilters = (scope: string): CustomQuickFilter[] => readStorage(scope);

export const addCustomQuickFilter = (
  scope: string,
  name: string,
  url: string
): CustomQuickFilter[] | null => {
  const normalizedName = normalizeName(name);
  const normalizedURL = normalizeURL(url);
  if (!normalizeScope(scope) || !normalizedName || normalizedURL === null) return null;

  const nextFilter: CustomQuickFilter = {
    id: createId(),
    name: normalizedName,
    url: normalizedURL,
    createdAt: Date.now()
  };
  const nextFilters = [nextFilter, ...readStorage(scope)].slice(0, MAX_CUSTOM_QUICK_FILTERS);
  return writeStorage(scope, nextFilters) ? nextFilters : null;
};

export const removeCustomQuickFilter = (scope: string, id: string): CustomQuickFilter[] | null => {
  if (!normalizeScope(scope) || !id) return null;
  const nextFilters = readStorage(scope).filter((filter) => filter.id !== id);
  return writeStorage(scope, nextFilters) ? nextFilters : null;
};
