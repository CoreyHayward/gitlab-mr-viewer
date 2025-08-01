// Utility functions for persisting UI state in localStorage

interface UIState {
  filtersExpanded?: boolean;
  projectSelectorOpen?: boolean;
}

const UI_STATE_KEY = 'gitlab-mr-viewer-ui-state';

export const loadUIState = (): UIState => {
  if (typeof window === 'undefined') {
    return {}; // Return empty state on server-side
  }

  try {
    const saved = localStorage.getItem(UI_STATE_KEY);
    if (saved) {
      return JSON.parse(saved);
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
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(newState));
  } catch (error) {
    console.warn('Failed to save UI state to localStorage:', error);
  }
};

export const clearUIState = (): void => {
  if (typeof window === 'undefined') {
    return; // Skip on server-side
  }

  try {
    localStorage.removeItem(UI_STATE_KEY);
  } catch (error) {
    console.warn('Failed to clear UI state from localStorage:', error);
  }
};
