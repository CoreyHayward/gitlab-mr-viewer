'use client';

import { useState, useEffect } from 'react';
import { GitLabProject } from '@/types/gitlab';
import { GitLabService } from '@/services/gitlab';
import { loadUIState, saveUIState } from '@/utils/uiState';

interface ProjectSelectorProps {
  service: GitLabService;
  selectedProject: GitLabProject | null;
  onProjectSelect: (project: GitLabProject | null) => void;
}

export default function ProjectSelector({ service, selectedProject, onProjectSelect }: ProjectSelectorProps) {
  const [projects, setProjects] = useState<GitLabProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);

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
      setLoading(true);
      setError(null);
      
      try {
        const projectList = await service.getProjects();
        setProjects(projectList);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    };

    loadInitialProjects();
  }, [service]);

  const loadProjects = async (search?: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const projectList = await service.getProjects(search);
      setProjects(projectList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
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

  const handleProjectSelect = (project: GitLabProject | null) => {
    onProjectSelect(project);
    setIsOpen(false);
    saveUIState({ projectSelectorOpen: false });
  };

  useEffect(() => {
    const loadInitialProjects = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const projectList = await service.getProjects();
        setProjects(projectList);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    };

    loadInitialProjects();
  }, [service]);

  return (
    <div className="relative">
      <div className="bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Select Project
        </label>
        
        <button
          onClick={handleToggleOpen}
          className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 dark:border-neutral-600 rounded-md shadow-sm bg-white dark:bg-neutral-700 text-left focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
        >
          <span className="text-gray-900 dark:text-white">
            {selectedProject ? selectedProject.path_with_namespace : 'All Projects'}
          </span>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

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
                    onClick={() => handleProjectSelect(null)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700 ${
                      !selectedProject ? 'bg-violet-50 dark:bg-violet-900/20' : ''
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
                      onClick={() => handleProjectSelect(project)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0 focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700 ${
                        selectedProject?.id === project.id ? 'bg-violet-50 dark:bg-violet-900/20' : ''
                      }`}
                    >
                      <div className="font-medium text-gray-900 dark:text-white">
                        {project.name}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {project.path_with_namespace}
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
