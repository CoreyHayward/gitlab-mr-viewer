// Utility functions for persisting UI state in localStorage

interface UIState {
  filtersExpanded?: boolean;
  projectSelectorOpen?: boolean;
  mergeTrainWatcherExpanded?: boolean;
  mergeTrainWatcherVisible?: boolean;
  mergeRequestSort?: 'updated-desc' | 'updated-asc' | 'comments-desc' | 'size-desc';
  mergeRequestGroupBy?: 'none' | 'project' | 'author' | 'review';
}

const UI_STATE_KEY = 'gitlab-mr-viewer-ui-state';

const validatedUIState = (value: unknown): UIState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  return {
    ...(typeof candidate.filtersExpanded === 'boolean' ? { filtersExpanded: candidate.filtersExpanded } : {}),
    ...(typeof candidate.projectSelectorOpen === 'boolean' ? { projectSelectorOpen: candidate.projectSelectorOpen } : {}),
    ...(typeof candidate.mergeTrainWatcherExpanded === 'boolean' ? { mergeTrainWatcherExpanded: candidate.mergeTrainWatcherExpanded } : {}),
    ...(typeof candidate.mergeTrainWatcherVisible === 'boolean' ? { mergeTrainWatcherVisible: candidate.mergeTrainWatcherVisible } : {}),
    ...(candidate.mergeRequestSort === 'updated-desc' || candidate.mergeRequestSort === 'updated-asc' || candidate.mergeRequestSort === 'comments-desc' || candidate.mergeRequestSort === 'size-desc'
      ? { mergeRequestSort: candidate.mergeRequestSort }
      : {}),
    ...(candidate.mergeRequestGroupBy === 'none' || candidate.mergeRequestGroupBy === 'project' || candidate.mergeRequestGroupBy === 'author' || candidate.mergeRequestGroupBy === 'review'
      ? { mergeRequestGroupBy: candidate.mergeRequestGroupBy }
      : {})
  };
};

export const loadUIState = (): UIState => {
  if (typeof window === 'undefined') {
    return {}; // Return empty state on server-side
  }

  try {
    const saved = window.localStorage.getItem(UI_STATE_KEY);
    if (saved) {
      return validatedUIState(JSON.parse(saved));
    }
  } catch (error) {
    console.warn('Failed to load UI state from localStorage:', error);
  }
  
  return {};
};

export const saveUIState = (state: Partial<UIState>): void => {
  if (typeof window === 'undefined') {
    return; // Skip on server-side
  }

  try {
    const currentState = loadUIState();
    const newState = { ...currentState, ...state };
    window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(newState));
  } catch (error) {
    console.warn('Failed to save UI state to localStorage:', error);
  }
};

export const clearUIState = (): void => {
  if (typeof window === 'undefined') {
    return; // Skip on server-side
  }

  try {
    window.localStorage.removeItem(UI_STATE_KEY);
  } catch (error) {
    console.warn('Failed to clear UI state from localStorage:', error);
  }
};
