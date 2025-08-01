'use client';

import { useState } from 'react';
import { FilterOptions } from '@/types/gitlab';
import { GitLabService } from '@/services/gitlab';
import UserMultiSelect from './UserMultiSelect';

interface FilterPanelProps {
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  isExpanded: boolean;
  onToggle: () => void;
  service: GitLabService;
}

export default function FilterPanel({ filters, onFiltersChange, isExpanded, onToggle, service }: FilterPanelProps) {
  const [localFilters, setLocalFilters] = useState<FilterOptions>(filters);

  const handleFilterChange = (key: keyof FilterOptions, value: string | string[] | boolean | undefined) => {
    const newFilters = { ...localFilters, [key]: value };
    setLocalFilters(newFilters);
    onFiltersChange(newFilters);
  };

  const handleLabelsChange = (value: string) => {
    const labels = value.split(',').map(l => l.trim()).filter(l => l.length > 0);
    handleFilterChange('labels', labels.length > 0 ? labels : undefined);
  };

  const handleProjectsChange = (value: string) => {
    const projects = value.split(',').map(p => p.trim()).filter(p => p.length > 0);
    handleFilterChange('projects', projects.length > 0 ? projects : undefined);
  };

  const clearFilters = () => {
    const emptyFilters: FilterOptions = { state: 'opened' };
    setLocalFilters(emptyFilters);
    onFiltersChange(emptyFilters);
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={onToggle}
          className="flex items-center justify-between w-full text-left"
        >
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Filters
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Apply filters to search more merge requests across all projects (recommended for large instances)
            </p>
          </div>
          <svg
            className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isExpanded && (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                State
              </label>
              <select
                value={localFilters.state || 'all'}
                onChange={(e) => handleFilterChange('state', e.target.value as 'opened' | 'closed' | 'merged' | 'all')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              >
                <option value="all">All</option>
                <option value="opened">Open</option>
                <option value="merged">Merged</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <UserMultiSelect
              service={service}
              selectedUsers={localFilters.authors || []}
              onUsersChange={(usernames) => handleFilterChange('authors', usernames.length > 0 ? usernames : undefined)}
              placeholder="Search and select authors..."
              label="Authors"
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Assignee
              </label>
              <input
                type="text"
                value={localFilters.assignee || ''}
                onChange={(e) => handleFilterChange('assignee', e.target.value || undefined)}
                placeholder="Username"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Reviewer
              </label>
              <input
                type="text"
                value={localFilters.reviewer || ''}
                onChange={(e) => handleFilterChange('reviewer', e.target.value || undefined)}
                placeholder="Username"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Source Branch
              </label>
              <input
                type="text"
                value={localFilters.sourceBranch || ''}
                onChange={(e) => handleFilterChange('sourceBranch', e.target.value || undefined)}
                placeholder="Branch name"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Target Branch
              </label>
              <input
                type="text"
                value={localFilters.targetBranch || ''}
                onChange={(e) => handleFilterChange('targetBranch', e.target.value || undefined)}
                placeholder="Branch name"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title Contains
              </label>
              <input
                type="text"
                value={localFilters.title || ''}
                onChange={(e) => handleFilterChange('title', e.target.value || undefined)}
                placeholder="Search in title"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Labels
              </label>
              <input
                type="text"
                value={localFilters.labels?.join(', ') || ''}
                onChange={(e) => handleLabelsChange(e.target.value)}
                placeholder="label1, label2, label3"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Projects (when viewing all)
              </label>
              <input
                type="text"
                value={localFilters.projects?.join(', ') || ''}
                onChange={(e) => handleProjectsChange(e.target.value)}
                placeholder="project1, project2/subproject"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Created After
              </label>
              <input
                type="date"
                value={localFilters.dateFrom || ''}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value || undefined)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Created Before
              </label>
              <input
                type="date"
                value={localFilters.dateTo || ''}
                onChange={(e) => handleFilterChange('dateTo', e.target.value || undefined)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={localFilters.draft === true}
                onChange={(e) => handleFilterChange('draft', e.target.checked ? true : undefined)}
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">Draft only</span>
            </label>

            <button
              onClick={clearFilters}
              className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Clear Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
