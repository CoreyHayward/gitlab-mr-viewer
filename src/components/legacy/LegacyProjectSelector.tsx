'use client';

import { useState, useEffect, useRef } from 'react';
import { GitLabProject } from '@/types/gitlab';
import { GitLabService } from '@/services/gitlab';
import { loadUIState, saveUIState } from '@/utils/uiState';
import { ChevronDown, X, Check, Search } from 'lucide-react';
import { MAX_SHARED_LIST_VALUES } from '@/utils/urlState';

interface ProjectSelectorProps {
  service: GitLabService;
  selectedProjects: GitLabProject[];
  onProjectsChange: (projects: GitLabProject[]) => void;
}

export default function LegacyProjectSelector({ service, selectedProjects, onProjectsChange }: ProjectSelectorProps) {
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
    if (!isOpen) {
      abortControllerRef.current?.abort();
      setLoading(false);
      return;
    }

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
        const projectList = await service.getProjects(searchTerm.trim() || undefined, controller.signal);
        
        // Only update state if this request wasn't cancelled
        if (!controller.signal.aborted) {
          setProjects(projectList);
        }
      } catch (err) {
        // Don't show errors for cancelled requests
        if (controller.signal.aborted) return;
        
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      } finally {
        // Only clear loading if this request wasn't cancelled
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    const timer = window.setTimeout(loadInitialProjects, searchTerm.trim() ? 300 : 0);

    // Cleanup on unmount or service change
    return () => {
      window.clearTimeout(timer);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isOpen, searchTerm, service]);

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

  const handleSearch = (term: string) => {
    setSearchTerm(term);
  };

  const handleToggleOpen = () => {
    const newIsOpen = !isOpen;
    setIsOpen(newIsOpen);
    saveUIState({ projectSelectorOpen: newIsOpen });
  };

  const handleProjectToggle = (project: GitLabProject) => {
    const isSelected = selectedProjects.some((selectedProject) => selectedProject.id === project.id);

    if (isSelected) {
      setError(null);
      onProjectsChange(selectedProjects.filter((selectedProject) => selectedProject.id !== project.id));
      return;
    }

    if (selectedProjects.length >= MAX_SHARED_LIST_VALUES) {
      setError(`Choose up to ${MAX_SHARED_LIST_VALUES} projects so this view remains shareable.`);
      return;
    }

    setError(null);
    onProjectsChange([...selectedProjects, project]);
  };

  const handleClearSelection = () => {
    onProjectsChange([]);
  };

  const handleListboxKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
    if (options.length === 0) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
          ? Math.min(currentIndex + 1, options.length - 1)
          : Math.max(currentIndex < 0 ? options.length - 1 : currentIndex - 1, 0);
    options[nextIndex]?.focus();
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
        className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100 dark:hover:bg-neutral-700"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="accessible-project-options"
      >
        <span className="max-w-48 truncate font-medium">{getSelectionLabel()}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          <div className="border-b border-gray-100 p-3 dark:border-neutral-700">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search projects…"
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  const options = Array.from(dropdownRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
                  if (options.length === 0) return;
                  event.preventDefault();
                  options[event.key === 'ArrowDown' ? 0 : options.length - 1]?.focus();
                }}
                aria-label="Search your GitLab projects"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls="accessible-project-options"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white dark:focus:ring-violet-500/20"
              />
            </div>
          </div>
          {selectedProjects.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b border-gray-100 p-3 dark:border-neutral-700">
              {selectedProjects.map((project) => (
                <span key={project.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-200">
                  <span className="max-w-44 truncate">{project.path_with_namespace}</span>
                  <button type="button" onClick={() => handleProjectToggle(project)} className="rounded-full p-0.5 hover:bg-violet-100 dark:hover:bg-violet-800" aria-label={`Remove ${project.path_with_namespace}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div id="accessible-project-options" className="max-h-72 overflow-y-auto" role="listbox" aria-label="Accessible projects" aria-multiselectable="true" onKeyDown={handleListboxKeyDown}>
            {loading ? <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">Loading projects…</div>
              : error ? <div className="p-4 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
              : projects.length === 0 ? <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">No projects found</div>
              : <>
                <button type="button" role="option" aria-selected={selectedProjects.length === 0} onClick={handleClearSelection} className={`flex w-full items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:border-neutral-700 dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 ${selectedProjects.length === 0 ? 'bg-violet-50 dark:bg-violet-900/20' : ''}`}>
                  <span><span className="block text-sm font-medium text-gray-900 dark:text-white">All Projects</span><span className="block text-xs text-gray-500 dark:text-gray-400">Projects you belong to</span></span>
                  {selectedProjects.length === 0 && <Check className="h-4 w-4 text-violet-600 dark:text-violet-300" />}
                </button>
                {projects.map((project) => {
                  const selected = selectedProjects.some((selectedProject) => selectedProject.id === project.id);
                  return <button key={project.id} type="button" role="option" aria-selected={selected} onClick={() => handleProjectToggle(project)} className={`flex w-full items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none last:border-b-0 dark:border-neutral-700 dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 ${selected ? 'bg-violet-50 dark:bg-violet-900/20' : ''}`}>
                    <span className="min-w-0"><span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{project.name}</span><span className="block truncate text-xs text-gray-500 dark:text-gray-400">{project.path_with_namespace}</span></span>
                    {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" />}
                  </button>;
                })}
              </>}
          </div>
        </div>
      )}
    </div>
  );
}
