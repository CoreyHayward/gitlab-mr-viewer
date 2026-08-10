import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadUIState, saveUIState } from '@/utils/uiState';

const localStorageStub = (initial?: string) => {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set('gitlab-mr-viewer-ui-state', initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
};

describe('UI state storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ignores invalid storage shapes and fields', () => {
    vi.stubGlobal('window', { localStorage: localStorageStub('null') });
    expect(loadUIState()).toEqual({});

    vi.stubGlobal('window', {
      localStorage: localStorageStub(JSON.stringify({
        filtersExpanded: true,
        projectSelectorOpen: 'yes',
        unexpected: true
      }))
    });
    expect(loadUIState()).toEqual({ filtersExpanded: true });
  });

  it('merges validated values when saving', () => {
    const localStorage = localStorageStub(JSON.stringify({ filtersExpanded: true }));
    vi.stubGlobal('window', { localStorage });

    saveUIState({ mergeTrainWatcherVisible: false });

    expect(loadUIState()).toEqual({ filtersExpanded: true, mergeTrainWatcherVisible: false });
  });
});
