import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addCustomQuickFilter,
  customQuickFiltersStorageKey,
  loadCustomQuickFilters,
  removeCustomQuickFilter
} from '@/utils/customQuickFilters';

const localStorageStub = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
};

describe('custom quick filter storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps filters scoped to the GitLab instance and user', () => {
    const localStorage = localStorageStub();
    vi.stubGlobal('window', { localStorage });

    expect(customQuickFiltersStorageKey('https://gitlab.example|42')).not.toBe(
      customQuickFiltersStorageKey('https://gitlab.example|99')
    );
    expect(customQuickFiltersStorageKey('https://gitlab.example|42')).not.toBe(
      customQuickFiltersStorageKey('https://other.example|42')
    );

    const filters = addCustomQuickFilter('https://gitlab.example|42', 'Needs review', '?state=opened&approvalState=needs-approval');

    expect(filters).toHaveLength(1);
    expect(loadCustomQuickFilters('https://gitlab.example|42')).toEqual(filters);
    expect(loadCustomQuickFilters('https://gitlab.example|99')).toEqual([]);
  });

  it('normalizes names and stores only the filter query from a URL', () => {
    vi.stubGlobal('window', { localStorage: localStorageStub() });

    const filters = addCustomQuickFilter(
      'scope',
      '  Recently touched  ',
      'https://viewer.example.test/?project=42&title=auth#review'
    );

    expect(filters?.[0]).toMatchObject({ name: 'Recently touched', url: '?project=42&title=auth' });
    expect(addCustomQuickFilter('scope', 'Invalid URL', 'javascript:alert(1)')).toBeNull();
  });

  it('ignores malformed saved entries and removes a saved filter', () => {
    const localStorage = localStorageStub();
    vi.stubGlobal('window', { localStorage });
    localStorage.setItem(customQuickFiltersStorageKey('scope'), JSON.stringify([
      { id: 'valid', name: 'Valid', url: '?state=closed', createdAt: 10 },
      { id: 'bad-name', name: '', url: '?state=opened', createdAt: 11 },
      { id: 'bad-date', name: 'Bad date', url: '?state=opened', createdAt: 'now' }
    ]));

    expect(loadCustomQuickFilters('scope')).toEqual([{
      id: 'valid',
      name: 'Valid',
      url: '?state=closed',
      createdAt: 10
    }]);

    expect(removeCustomQuickFilter('scope', 'valid')).toEqual([]);
    expect(loadCustomQuickFilters('scope')).toEqual([]);
  });
});
