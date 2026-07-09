'use client';

import { useState, useEffect, useRef } from 'react';
import { GitLabProject } from '@/types/gitlab';
import { GitLabService } from '@/services/gitlab';
import { loadUIState, saveUIState } from '@/utils/uiState';
import { ChevronDown, X, Check, Search } from 'lucide-react';

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
      <button
        type="button"
        onClick={handleToggleOpen}
        className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:bg-white/[0.08]"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="max-w-48 truncate font-medium">{getSelectionLabel()}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900">
          <div className="border-b border-slate-100 p-3 dark:border-white/10">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search projects…"
                value={searchTerm}
                onChange={(event) => handleSearch(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20"
              />
            </div>
            {selectedProjects.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selectedProjects.map((project) => (
                  <span key={project.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-200">
                    <span className="max-w-44 truncate">{project.path_with_namespace}</span>
                    <button
                      type="button"
                      onClick={() => handleProjectToggle(project)}
                      className="rounded-full p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-300/20"
                      aria-label={`Remove ${project.path_with_namespace}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto" role="listbox">
            {loading ? (
              <div className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">Loading projects…</div>
            ) : error ? (
              <div className="p-4 text-center text-sm text-rose-600 dark:text-rose-300">{error}</div>
            ) : projects.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">No projects found</div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none dark:border-white/10 dark:hover:bg-white/[0.06] dark:focus:bg-white/[0.06] ${
                    selectedProjects.length === 0 ? 'bg-indigo-50/70 dark:bg-indigo-400/10' : ''
                  }`}
                >
                  <span><span className="block text-sm font-medium text-slate-900 dark:text-white">All projects</span><span className="block text-xs text-slate-500 dark:text-slate-400">Your accessible project scope</span></span>
                  {selectedProjects.length === 0 && <Check className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />}
                </button>
                {projects.map((project) => {
                  const selected = selectedProjects.some((selectedProject) => selectedProject.id === project.id);
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => handleProjectToggle(project)}
                      className={`flex w-full items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none dark:border-white/10 dark:hover:bg-white/[0.06] dark:focus:bg-white/[0.06] ${
                        selected ? 'bg-indigo-50/70 dark:bg-indigo-400/10' : ''
                      }`}
                    >
                      <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{project.name}</span><span className="block truncate text-xs text-slate-500 dark:text-slate-400">{project.path_with_namespace}</span></span>
                      {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" />}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
