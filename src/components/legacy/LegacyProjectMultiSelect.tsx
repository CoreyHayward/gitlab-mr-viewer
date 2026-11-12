'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GitLabProject } from '@/types/gitlab';
import { GitLabService } from '@/services/gitlab';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { Check, ChevronDown, Layers, Loader2, Plus, X } from 'lucide-react';
import { MAX_SHARED_LIST_VALUE_LENGTH, MAX_SHARED_LIST_VALUES } from '@/utils/urlState';

interface ProjectMultiSelectProps {
  service: GitLabService;
  selectedProjects: string[];
  onProjectsChange: (projects: string[]) => void;
}

const sameProject = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export default function LegacyProjectMultiSelect({ service, selectedProjects, onProjectsChange }: ProjectMultiSelectProps) {
  const [projects, setProjects] = useState<GitLabProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(searchTerm.trim(), 300);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const listboxId = `${inputId}-options`;

  useEffect(() => {
    if (!isOpen) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    service.getProjects(debouncedSearch || undefined, controller.signal)
      .then((projectList) => {
        if (!controller.signal.aborted) setProjects(projectList);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Failed to load projects');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [isOpen, debouncedSearch, service]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isSelected = (value: string) => selectedProjects.some((selected) => sameProject(selected, value));

  const toggleProject = (value: string) => {
    if (isSelected(value)) {
      setError(null);
      onProjectsChange(selectedProjects.filter((selected) => !sameProject(selected, value)));
      return;
    }
    if (selectedProjects.length >= MAX_SHARED_LIST_VALUES) {
      setError(`Choose up to ${MAX_SHARED_LIST_VALUES} projects so this filter remains shareable.`);
      return;
    }
    setError(null);
    onProjectsChange([...selectedProjects, value.slice(0, MAX_SHARED_LIST_VALUE_LENGTH)]);
  };

  const typedValue = searchTerm.trim();
  const exactMatch = projects.find((project) => sameProject(project.name, typedValue) || sameProject(project.path_with_namespace, typedValue));
  const canAddTypedValue = typedValue !== '' && !exactMatch && !isSelected(typedValue);
  const searchPending = typedValue !== debouncedSearch;

  const addTypedValue = () => {
    if (!typedValue) return;
    const value = exactMatch?.path_with_namespace ?? typedValue;
    if (!isSelected(value)) toggleProject(value);
    setSearchTerm('');
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

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Projects
        <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">(up to {MAX_SHARED_LIST_VALUES})</span>
      </label>

      <div className="relative" ref={dropdownRef}>
        {selectedProjects.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {selectedProjects.map((project) => (
              <span key={project} className="inline-flex max-w-full items-center rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-800 dark:bg-neutral-800 dark:text-gray-200">
                <span className="truncate font-medium">{project}</span>
                <button
                  type="button"
                  onClick={() => toggleProject(project)}
                  aria-label={`Remove ${project}`}
                  className="ml-2 rounded-full p-0.5 text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-neutral-700 dark:hover:text-gray-200"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Layers className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            id={inputId}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            value={searchTerm}
            maxLength={MAX_SHARED_LIST_VALUE_LENGTH}
            onChange={(event) => { setSearchTerm(event.target.value); setIsOpen(true); }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTypedValue();
                return;
              }
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              const options = Array.from(dropdownRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
              if (options.length === 0) return;
              event.preventDefault();
              options[event.key === 'ArrowDown' ? 0 : options.length - 1]?.focus();
            }}
            placeholder="Search projects…"
            className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 hover:border-gray-400 focus:border-[#e24329] focus:outline-none focus:ring-2 focus:ring-[#e24329]/20 dark:border-neutral-600 dark:bg-neutral-800 dark:text-white dark:placeholder:text-gray-500"
          />
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
            <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {isOpen && (
          <div id={listboxId} role="listbox" aria-label="GitLab projects" aria-multiselectable="true" onKeyDown={handleListboxKeyDown} className="absolute z-50 mt-2 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
            {error && <div className="border-b border-gray-100 p-3 text-sm text-rose-700 dark:border-neutral-700 dark:text-rose-300" role="alert">{error}</div>}
            {loading || searchPending ? (
              <div className="flex items-center justify-center gap-2 p-4 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading projects…
              </div>
            ) : (
              <>
                {projects.map((project) => {
                  const selectedValue = selectedProjects.find((value) => sameProject(value, project.path_with_namespace) || sameProject(value, project.name));
                  const selected = selectedValue !== undefined;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => toggleProject(selectedValue ?? project.path_with_namespace)}
                      className={`flex w-full items-start justify-between gap-3 border-b border-gray-100 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:border-neutral-700 dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 ${selected ? 'bg-[#e24329]/5 dark:bg-[#e24329]/10' : ''}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{project.name}</span>
                        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{project.path_with_namespace}</span>
                      </span>
                      {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#e24329]" />}
                    </button>
                  );
                })}
                {canAddTypedValue && (
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={addTypedValue}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-gray-200 dark:hover:bg-neutral-700 dark:focus:bg-neutral-700"
                  >
                    <Plus className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="min-w-0 truncate">Match name or path &ldquo;{typedValue}&rdquo;</span>
                  </button>
                )}
                {projects.length === 0 && !canAddTypedValue && (
                  <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">No projects found</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
