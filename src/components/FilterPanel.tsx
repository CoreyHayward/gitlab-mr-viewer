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

  const handleProjectsChange = (value: string) => {
    const projects = value.split(',').map(p => p.trim()).filter(p => p.length > 0);
    handleFilterChange('projects', projects.length > 0 ? projects : undefined);
  };

  const clearFilters = () => {
    const emptyFilters: FilterOptions = { state: 'opened' };
    setLocalFilters(emptyFilters);
    onFiltersChange(emptyFilters);
  };

  // Count active filters (excluding default state)
  const activeFiltersCount = Object.entries(localFilters).filter(([key, value]) => {
    if (key === 'state' && value === 'opened') return false; // Default state
    return value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0);
  }).length;

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
      <div className="p-6">
        <button
          onClick={onToggle}
          className="flex items-center justify-between w-full text-left group hover:bg-gray-50 dark:hover:bg-gray-700/50 -m-2 p-2 rounded-lg transition-colors"
        >
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-sm">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.414A1 1 0 013 6.707V4z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Advanced Filters
                </h3>
                {activeFiltersCount > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {activeFiltersCount} active
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Refine your search across all projects
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {activeFiltersCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearFilters();
                }}
                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                Clear all
              </button>
            )}
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="p-6 space-y-8">
            {/* Quick Filters Section */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
                Quick Filters
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* State Filter */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Merge Request State
                  </label>
                  <div className="relative">
                    <select
                      value={localFilters.state || 'all'}
                      onChange={(e) => handleFilterChange('state', e.target.value as 'opened' | 'closed' | 'merged' | 'all')}
                      className="w-full px-4 py-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:text-white transition-all duration-200 appearance-none cursor-pointer hover:border-gray-400 dark:hover:border-gray-500"
                    >
                      <option value="all">All States</option>
                      <option value="opened">🟢 Open</option>
                      <option value="merged">🟣 Merged</option>
                      <option value="closed">🔴 Closed</option>
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Authors Filter */}
                <div className="space-y-2">
                  <UserMultiSelect
                    service={service}
                    selectedUsers={localFilters.authors || []}
                    onUsersChange={(usernames) => handleFilterChange('authors', usernames.length > 0 ? usernames : undefined)}
                    placeholder="Search and select authors..."
                    label="Authors"
                  />
                </div>
              </div>
            </div>

            {/* Search & Project Filters */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
                Search & Scope
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Title Search */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Search in Title
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <input
                      type="text"
                      value={localFilters.title || ''}
                      onChange={(e) => handleFilterChange('title', e.target.value || undefined)}
                      placeholder="Search merge request titles..."
                      className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-all duration-200 hover:border-gray-400 dark:hover:border-gray-500"
                    />
                  </div>
                </div>

                {/* Projects Filter */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Specific Projects
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">(when viewing all)</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <input
                      type="text"
                      value={localFilters.projects?.join(', ') || ''}
                      onChange={(e) => handleProjectsChange(e.target.value)}
                      placeholder="project1, group/project2, ..."
                      className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-all duration-200 hover:border-gray-400 dark:hover:border-gray-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Date Range Filters */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
                Date Range
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Date From */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Created After
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <input
                      type="date"
                      value={localFilters.dateFrom || ''}
                      onChange={(e) => handleFilterChange('dateFrom', e.target.value || undefined)}
                      className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:text-white transition-all duration-200 hover:border-gray-400 dark:hover:border-gray-500"
                    />
                  </div>
                </div>

                {/* Date To */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Created Before
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <input
                      type="date"
                      value={localFilters.dateTo || ''}
                      onChange={(e) => handleFilterChange('dateTo', e.target.value || undefined)}
                      className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:text-white transition-all duration-200 hover:border-gray-400 dark:hover:border-gray-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Additional Options */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
                Additional Options
              </h4>
              <div className="flex items-center justify-between">
                <label className="flex items-center space-x-3 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={localFilters.draft === true}
                      onChange={(e) => handleFilterChange('draft', e.target.checked ? true : undefined)}
                      className="sr-only"
                    />
                    <div className={`w-5 h-5 rounded border-2 transition-all duration-200 ${
                      localFilters.draft === true
                        ? 'bg-blue-500 border-blue-500'
                        : 'border-gray-300 dark:border-gray-600 group-hover:border-blue-400'
                    }`}>
                      {localFilters.draft === true && (
                        <svg className="w-3 h-3 text-white absolute top-0.5 left-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                      Draft Merge Requests Only
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Show only merge requests marked as drafts
                    </p>
                  </div>
                </label>

                {activeFiltersCount > 0 && (
                  <button
                    onClick={clearFilters}
                    className="inline-flex items-center px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-600 transition-all duration-200 hover:shadow-sm"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Clear All Filters
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
