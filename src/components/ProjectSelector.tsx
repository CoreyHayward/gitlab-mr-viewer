'use client';

import { useState, useEffect, useRef } from 'react';
import { GitLabProject } from '@/types/gitlab';
import { GitLabService } from '@/services/gitlab';
import { loadUIState, saveUIState } from '@/utils/uiState';

interface ProjectSelectorProps {
  service: GitLabService;
  selectedProjects: GitLabProject[];
  onProjectsChange: (projects: GitLabProject[]) => void;
}

export default function ProjectSelector({ service, selectedProjects, onProjectsChange }: ProjectSelectorProps) {
  const [projects, setProjects] = useState<GitLabProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize UI state from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedUIState = loadUIState();
      if (savedUIState.projectSelectorOpen !== undefined) {
        setIsOpen(savedUIState.projectSelectorOpen);
      }
    }
  }, []);

  useEffect(() => {
    const loadInitialProjects = async () => {
      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(null);
      
      try {
        const projectList = await service.getProjects(undefined, controller.signal);
        
        // Only update state if this request wasn't cancelled
        if (!controller.signal.aborted) {
          setProjects(projectList);
        }
      } catch (err) {
        // Don't show errors for cancelled requests
        if (err instanceof Error && err.message === 'Request cancelled') {
          return;
        }
        
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      } finally {
        // Only clear loading if this request wasn't cancelled
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadInitialProjects();

    // Cleanup on unmount or service change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [service]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        saveUIState({ projectSelectorOpen: false });
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadProjects = async (search?: string) => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);
    
    try {
      const projectList = await service.getProjects(search, controller.signal);
      
      // Only update state if this request wasn't cancelled
      if (!controller.signal.aborted) {
        setProjects(projectList);
      }
    } catch (err) {
      // Don't show errors for cancelled requests
      if (err instanceof Error && err.message === 'Request cancelled') {
        return;
      }
      
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      // Only clear loading if this request wasn't cancelled
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleSearch = (term: string) => {
    setSearchTerm(term);
    if (term.trim()) {
      loadProjects(term);
    } else {
      loadProjects();
    }
  };

  const handleToggleOpen = () => {
    const newIsOpen = !isOpen;
    setIsOpen(newIsOpen);
    saveUIState({ projectSelectorOpen: newIsOpen });
  };

  const handleProjectToggle = (project: GitLabProject) => {
    const isSelected = selectedProjects.some((selectedProject) => selectedProject.id === project.id);

    if (isSelected) {
      onProjectsChange(selectedProjects.filter((selectedProject) => selectedProject.id !== project.id));
      return;
    }

    onProjectsChange([...selectedProjects, project]);
  };

  const handleClearSelection = () => {
    onProjectsChange([]);
  };

  const getSelectionLabel = () => {
    if (selectedProjects.length === 0) {
      return 'All Projects';
    }

    if (selectedProjects.length === 1) {
      return selectedProjects[0].path_with_namespace;
    }

    return `${selectedProjects.length} projects selected`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Select Projects
        </label>
        
        <button
          onClick={handleToggleOpen}
          className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 dark:border-neutral-600 rounded-md shadow-sm bg-white dark:bg-neutral-700 text-left focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
        >
          <div className="min-w-0">
            <div className="truncate text-gray-900 dark:text-white">
              {getSelectionLabel()}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {selectedProjects.length === 0
                ? 'Show merge requests from all accessible projects'
                : `${selectedProjects.length} selected`}
            </div>
          </div>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {selectedProjects.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedProjects.map((project) => (
              <span
                key={project.id}
                className="inline-flex items-center px-3 py-1 bg-violet-50 dark:bg-violet-900/20 text-violet-800 dark:text-violet-200 text-sm rounded-full border border-violet-200 dark:border-violet-800"
              >
                <span className="max-w-64 truncate">{project.path_with_namespace}</span>
                <button
                  onClick={() => handleProjectToggle(project)}
                  className="ml-2 text-violet-600 dark:text-violet-300 hover:text-violet-800 dark:hover:text-violet-100"
                  aria-label={`Remove ${project.path_with_namespace}`}
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {isOpen && (
          <div className="absolute z-10 w-full mt-1 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-md shadow-lg">
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <input
                type="text"
                placeholder="Search projects..."
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 dark:bg-neutral-700 dark:text-white text-sm"
              />
            </div>
            
            <div className="max-h-60 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                  Loading projects...
                </div>
              ) : error ? (
                <div className="p-4 text-center text-red-600 dark:text-red-400">
                  {error}
                </div>
              ) : projects.length === 0 ? (
                <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                  No projects found
                </div>
              ) : (
                <>
                  <button
                    onClick={handleClearSelection}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700 ${
                      selectedProjects.length === 0 ? 'bg-violet-50 dark:bg-violet-900/20' : ''
                    }`}
                  >
                    <div className="font-medium text-gray-900 dark:text-white">
                      All Projects
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Show merge requests from all accessible projects
                    </div>
                  </button>
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => handleProjectToggle(project)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0 focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700 ${
                        selectedProjects.some((selectedProject) => selectedProject.id === project.id)
                          ? 'bg-violet-50 dark:bg-violet-900/20'
                          : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">
                            {project.name}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {project.path_with_namespace}
                          </div>
                        </div>
                        <div className={`mt-1 flex h-5 w-5 items-center justify-center rounded border ${
                          selectedProjects.some((selectedProject) => selectedProject.id === project.id)
                            ? 'border-violet-500 bg-violet-500 text-white'
                            : 'border-gray-300 dark:border-neutral-600 text-transparent'
                        }`}>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
