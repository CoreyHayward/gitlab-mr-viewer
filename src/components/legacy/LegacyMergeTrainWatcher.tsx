'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitLabService } from '@/services/gitlab';
import { GitLabMergeTrain, GitLabMergeTrainProjectStatus, GitLabProject } from '@/types/gitlab';
import { loadUIState, saveUIState } from '@/utils/uiState';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleCheck,
  Clock,
  EyeOff,
  GitBranch,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  X
} from 'lucide-react';

const WATCHED_PROJECTS_KEY = 'gitlab-merge-train-watch-projects';
const REFRESH_INTERVAL_MS = 60_000;
const TRAIN_MODE_CLICK_COUNT = 5;
const TRAIN_MODE_CLICK_WINDOW_MS = 1400;

interface MergeTrainWatcherProps {
  service: GitLabService;
  onHide?: () => void;
  trainModeEnabled?: boolean;
  onTrainModeChange?: (enabled: boolean) => void;
}

const isProject = (value: unknown): value is GitLabProject => {
  if (!value || typeof value !== 'object') return false;

  const project = value as Partial<GitLabProject>;
  return (
    typeof project.id === 'number' &&
    typeof project.name === 'string' &&
    typeof project.path_with_namespace === 'string' &&
    typeof project.web_url === 'string'
  );
};

const loadWatchedProjects = (): GitLabProject[] => {
  if (typeof window === 'undefined') return [];

  try {
    const saved = localStorage.getItem(WATCHED_PROJECTS_KEY);
    if (!saved) return [];

    const projects = JSON.parse(saved);
    if (!Array.isArray(projects)) return [];

    return projects.filter(isProject);
  } catch (error) {
    console.warn('Failed to load merge train watched projects:', error);
    return [];
  }
};

const saveWatchedProjects = (projects: GitLabProject[]) => {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(WATCHED_PROJECTS_KEY, JSON.stringify(projects));
  } catch (error) {
    console.warn('Failed to save merge train watched projects:', error);
  }
};

export default function LegacyMergeTrainWatcher({
  service,
  onHide,
  trainModeEnabled = false,
  onTrainModeChange
}: MergeTrainWatcherProps) {
  const [watchedProjects, setWatchedProjects] = useState<GitLabProject[]>([]);
  const [projectOptions, setProjectOptions] = useState<GitLabProject[]>([]);
  const [statuses, setStatuses] = useState<GitLabMergeTrainProjectStatus[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const pickerRef = useRef<HTMLDivElement>(null);
  const projectAbortControllerRef = useRef<AbortController | null>(null);
  const statusAbortControllerRef = useRef<AbortController | null>(null);
  const titleClickCountRef = useRef(0);
  const titleClickTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const savedUIState = loadUIState();
    if (savedUIState.mergeTrainWatcherExpanded !== undefined) {
      setIsExpanded(savedUIState.mergeTrainWatcherExpanded);
    }

    setWatchedProjects(loadWatchedProjects());
  }, []);

  const refreshStatuses = useCallback(async (projects = watchedProjects) => {
    if (projects.length === 0) {
      setStatuses([]);
      setLastUpdated(null);
      return;
    }

    if (statusAbortControllerRef.current) {
      statusAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    statusAbortControllerRef.current = controller;
    setStatusLoading(true);

    try {
      const nextStatuses = await service.getActiveMergeTrainsForProjects(projects, controller.signal);
      if (!controller.signal.aborted) {
        setStatuses(nextStatuses);
        setLastUpdated(new Date());
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Request cancelled') {
        return;
      }

      setStatuses(projects.map((project) => ({
        project,
        trains: [],
        error: error instanceof Error ? error.message : 'Failed to refresh merge trains'
      })));
    } finally {
      if (!controller.signal.aborted) {
        setStatusLoading(false);
      }
    }
  }, [service, watchedProjects]);

  const loadProjectOptions = useCallback(async (search?: string) => {
    if (projectAbortControllerRef.current) {
      projectAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    projectAbortControllerRef.current = controller;
    setProjectLoading(true);
    setProjectError(null);

    try {
      const projects = await service.getProjects(search, controller.signal);
      if (!controller.signal.aborted) {
        setProjectOptions(projects);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Request cancelled') {
        return;
      }

      setProjectError(error instanceof Error ? error.message : 'Failed to load projects');
    } finally {
      if (!controller.signal.aborted) {
        setProjectLoading(false);
      }
    }
  }, [service]);

  useEffect(() => {
    if (!isPickerOpen) return;
    void loadProjectOptions(searchTerm.trim() || undefined);
  }, [isPickerOpen, loadProjectOptions, searchTerm]);

  useEffect(() => {
    if (watchedProjects.length === 0) return;

    void refreshStatuses(watchedProjects);
    const intervalId = window.setInterval(() => {
      void refreshStatuses(watchedProjects);
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [refreshStatuses, watchedProjects]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (projectAbortControllerRef.current) {
        projectAbortControllerRef.current.abort();
      }
      if (statusAbortControllerRef.current) {
        statusAbortControllerRef.current.abort();
      }
      if (titleClickTimeoutRef.current) {
        window.clearTimeout(titleClickTimeoutRef.current);
      }
    };
  }, []);

  const summary = useMemo(() => {
    const totalTrains = statuses.reduce((total, status) => total + status.trains.length, 0);
    const errorCount = statuses.filter((status) => status.error).length;
    const busyCount = statuses.filter((status) => status.trains.length > 0).length;
    const clearCount = Math.max(watchedProjects.length - busyCount - errorCount, 0);

    return { totalTrains, busyCount, clearCount, errorCount };
  }, [statuses, watchedProjects.length]);

  const updateWatchedProjects = (projects: GitLabProject[]) => {
    const uniqueProjects = Array.from(new Map(projects.map((project) => [project.id, project])).values());
    const uniqueProjectIds = new Set(uniqueProjects.map((project) => project.id));

    setWatchedProjects(uniqueProjects);
    setStatuses((currentStatuses) => currentStatuses.filter((status) => uniqueProjectIds.has(status.project.id)));
    saveWatchedProjects(uniqueProjects);

    if (uniqueProjects.length === 0) {
      setStatuses([]);
      setLastUpdated(null);
    }
  };

  const handleProjectToggle = (project: GitLabProject) => {
    const isSelected = watchedProjects.some((watchedProject) => watchedProject.id === project.id);

    if (isSelected) {
      updateWatchedProjects(watchedProjects.filter((watchedProject) => watchedProject.id !== project.id));
      return;
    }

    updateWatchedProjects([...watchedProjects, project]);
  };

  const handleClearAll = () => {
    updateWatchedProjects([]);
  };

  const handleExpandedToggle = () => {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);
    saveUIState({ mergeTrainWatcherExpanded: nextExpanded });
  };

  const getProjectStatus = (project: GitLabProject) => {
    return statuses.find((status) => status.project.id === project.id) ?? { project, trains: [] };
  };

  const handleTitleClick = (event: React.MouseEvent<HTMLHeadingElement>) => {
    event.stopPropagation();

    if (titleClickTimeoutRef.current) {
      window.clearTimeout(titleClickTimeoutRef.current);
    }

    titleClickCountRef.current += 1;

    if (titleClickCountRef.current >= TRAIN_MODE_CLICK_COUNT) {
      titleClickCountRef.current = 0;
      onTrainModeChange?.(!trainModeEnabled);
      return;
    }

    titleClickTimeoutRef.current = window.setTimeout(() => {
      titleClickCountRef.current = 0;
      titleClickTimeoutRef.current = null;
    }, TRAIN_MODE_CLICK_WINDOW_MS);
  };

  const formatRelativeTime = (date: Date) => {
    const diffMinutes = Math.round((date.getTime() - Date.now()) / 60000);
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(diffMinutes, 'minute');
  };

  const getStatusTone = (status: string) => {
    switch (status) {
      case 'fresh':
      case 'idle':
        return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200';
      case 'stale':
        return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100';
      default:
        return 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200';
    }
  };

  const getPipelineTone = (status?: string) => {
    switch (status) {
      case 'success':
        return 'text-emerald-700 dark:text-emerald-300';
      case 'failed':
      case 'canceled':
        return 'text-rose-700 dark:text-rose-300';
      case 'running':
        return 'text-sky-700 dark:text-sky-300';
      case 'pending':
        return 'text-amber-700 dark:text-amber-300';
      default:
        return 'text-gray-500 dark:text-gray-400';
    }
  };

  const renderTrain = (train: GitLabMergeTrain, index: number) => (
    <div
      key={train.id}
      className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900/70"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{train.target_branch}</span>
        </span>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${getStatusTone(train.status)}`}>
          {train.status}
        </span>
      </div>
      <a
        href={train.merge_request.web_url}
        target="_blank"
        rel="noreferrer"
        className="line-clamp-2 font-medium text-gray-900 hover:text-violet-700 dark:text-white dark:hover:text-violet-300"
      >
        #{train.merge_request.iid} {train.merge_request.title}
      </a>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span>Position {index + 1}</span>
        <span>@{train.user.username}</span>
        {train.pipeline && (
          <a
            href={train.pipeline.web_url}
            target="_blank"
            rel="noreferrer"
            className={`font-medium hover:underline ${getPipelineTone(train.pipeline.status)}`}
          >
            Pipeline {train.pipeline.status}
          </a>
        )}
      </div>
    </div>
  );

  const renderTrainModeScene = () => {
    const trainCars = statuses.flatMap((projectStatus) => (
      projectStatus.trains.map((train, trainIndex) => ({
        project: projectStatus.project,
        train,
        trainIndex
      }))
    ));

    const clearProjects = watchedProjects.filter((project) => getProjectStatus(project).trains.length === 0);

    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900 dark:bg-amber-950/20">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-amber-950 dark:text-amber-100">
              Merge train yard
            </div>
            <div className="text-xs text-amber-800 dark:text-amber-200">
              {trainCars.length > 0
                ? `${trainCars.length} MR car${trainCars.length === 1 ? '' : 's'} making the loop`
                : 'No active MR cars on the track'}
            </div>
          </div>
          {clearProjects.length > 0 && (
            <div className="flex max-w-full flex-wrap gap-1.5">
              {clearProjects.slice(0, 4).map((project) => (
                <span
                  key={project.id}
                  className="max-w-56 truncate rounded-full border border-emerald-200 bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                >
                  {project.path_with_namespace} clear
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="merge-train-track-scene">
          <div className="merge-train-track" />
          <div className="merge-train-ties" />
          <div className={`merge-train-convoy ${trainCars.length === 0 ? 'merge-train-convoy-idle' : ''}`}>
            <div className="merge-train-engine">
              <div className="merge-train-engine-cab" />
              <div className="merge-train-engine-window" />
              <div className="merge-train-engine-stripe" />
              <div className="merge-train-wheel merge-train-wheel-left" />
              <div className="merge-train-wheel merge-train-wheel-right" />
            </div>

            {trainCars.length === 0 ? (
              <div className="merge-train-empty-car">
                Clear track
              </div>
            ) : (
              trainCars.map(({ project, train, trainIndex }, index) => (
                <a
                  key={train.id}
                  href={train.merge_request.web_url}
                  target="_blank"
                  rel="noreferrer"
                  className="merge-train-car"
                  title={`Position ${index + 1}: ${train.merge_request.title}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase">
                      Car {index + 1}
                    </span>
                    <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-medium capitalize text-amber-900 dark:bg-black/20 dark:text-amber-100">
                      {train.status}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs font-semibold">
                    #{train.merge_request.iid} {train.merge_request.title}
                  </span>
                  <span className="truncate text-[10px] font-medium">
                    {project.path_with_namespace}
                  </span>
                  <span className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="truncate">
                      Position {trainIndex + 1}
                    </span>
                    {train.pipeline && (
                      <span className={`shrink-0 font-semibold ${getPipelineTone(train.pipeline.status)}`}>
                        {train.pipeline.status}
                      </span>
                    )}
                  </span>
                  <span className="merge-train-car-wheel merge-train-car-wheel-left" />
                  <span className="merge-train-car-wheel merge-train-car-wheel-right" />
                </a>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className={`overflow-visible rounded-xl border bg-white shadow-sm dark:bg-neutral-800 ${
      trainModeEnabled
        ? 'border-amber-200 dark:border-amber-900'
        : 'border-gray-200 dark:border-neutral-700'
    }`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={handleExpandedToggle}
            className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-800 xl:cursor-default xl:focus:ring-0"
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
              summary.errorCount > 0
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200'
                : summary.totalTrains > 0
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
            }`}>
              {statusLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : summary.totalTrains > 0 ? <Clock className="h-5 w-5" /> : <CircleCheck className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  onClick={handleTitleClick}
                  title="Merge Train Watcher"
                  className={`text-base font-semibold text-gray-900 dark:text-white ${trainModeEnabled ? 'text-amber-800 dark:text-amber-200' : ''}`}
                >
                  Merge Train Watcher
                </h2>
                {watchedProjects.length > 0 && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-neutral-700 dark:text-gray-300">
                    {summary.totalTrains} queued
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {watchedProjects.length === 0
                  ? 'Pick repos to monitor their active train.'
                  : summary.totalTrains > 0
                    ? `${summary.busyCount} busy, ${summary.clearCount} clear`
                    : `${summary.clearCount} clear${summary.errorCount > 0 ? `, ${summary.errorCount} issue${summary.errorCount === 1 ? '' : 's'}` : ''}`}
              </p>
            </div>
          </button>

          <div className="flex items-center gap-1">
            {onHide && (
              <button
                type="button"
                onClick={onHide}
                className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-neutral-700 dark:hover:text-gray-200"
                title="Hide merge train watcher"
              >
                <EyeOff className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => refreshStatuses()}
              disabled={statusLoading || watchedProjects.length === 0}
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-neutral-700 dark:hover:text-gray-200"
              title="Refresh merge trains"
            >
              <RefreshCcw className={`h-4 w-4 ${statusLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={handleExpandedToggle}
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-neutral-700 dark:hover:text-gray-200 xl:hidden"
              title="Toggle merge train watcher"
            >
              <ChevronDown className={`h-5 w-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        <div className={`${isExpanded || trainModeEnabled ? 'block' : 'hidden'} mt-4 space-y-4 xl:block`}>
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setIsPickerOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-gray-200 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Plus className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                <span className="truncate">Add repos to watch</span>
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isPickerOpen ? 'rotate-180' : ''}`} />
            </button>

            {isPickerOpen && (
              <div className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
                <div className="border-b border-gray-100 p-3 dark:border-neutral-700">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search repos..."
                      className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white"
                    />
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto">
                  {projectLoading ? (
                    <div className="flex items-center justify-center gap-2 p-4 text-sm text-gray-500 dark:text-gray-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading repos...
                    </div>
                  ) : projectError ? (
                    <div className="p-4 text-sm text-rose-700 dark:text-rose-300">
                      {projectError}
                    </div>
                  ) : projectOptions.length === 0 ? (
                    <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
                      No repos found
                    </div>
                  ) : (
                    projectOptions.map((project) => {
                      const selected = watchedProjects.some((watchedProject) => watchedProject.id === project.id);

                      return (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => handleProjectToggle(project)}
                          className={`flex w-full items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 text-left last:border-b-0 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:border-neutral-700 dark:hover:bg-neutral-700 dark:focus:bg-neutral-700 ${
                            selected ? 'bg-violet-50 dark:bg-violet-950/20' : ''
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">
                              {project.name}
                            </span>
                            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                              {project.path_with_namespace}
                            </span>
                          </span>
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                            selected
                              ? 'border-violet-500 bg-violet-500 text-white'
                              : 'border-gray-300 text-transparent dark:border-neutral-600'
                          }`}>
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {watchedProjects.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {watchedProjects.map((project) => {
                const projectStatus = getProjectStatus(project);
                const tone = projectStatus.error
                  ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
                  : projectStatus.trains.length > 0
                    ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200';

                return (
                  <span
                    key={project.id}
                    className={`inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}
                  >
                    <span className="max-w-44 truncate">{project.path_with_namespace}</span>
                    <button
                      type="button"
                      onClick={() => handleProjectToggle(project)}
                      className="rounded-full p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                      aria-label={`Stop watching ${project.path_with_namespace}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                onClick={handleClearAll}
                className="rounded-full px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-neutral-700 dark:hover:text-gray-200"
              >
                Clear
              </button>
            </div>
          )}

          {watchedProjects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-neutral-700 dark:text-gray-400">
              The watcher is separate from the MR repo selector, so you can monitor release-critical repos without changing the list below.
            </div>
          ) : trainModeEnabled ? (
            <>
              {statuses.some((projectStatus) => projectStatus.error) && (
                <div className="space-y-3">
                  {statuses.filter((projectStatus) => projectStatus.error).map((projectStatus) => (
                    <div key={projectStatus.project.id} className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-rose-900 dark:text-rose-100">
                            {projectStatus.project.path_with_namespace}
                          </div>
                          <div className="mt-1 text-xs text-rose-700 dark:text-rose-200">
                            {projectStatus.error}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {renderTrainModeScene()}
            </>
          ) : (
            <div className="space-y-3">
              {watchedProjects.map((project) => {
                const projectStatus = getProjectStatus(project);

                if (projectStatus.error) {
                  return (
                    <div key={project.id} className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-rose-900 dark:text-rose-100">
                            {project.path_with_namespace}
                          </div>
                          <div className="mt-1 text-xs text-rose-700 dark:text-rose-200">
                            {projectStatus.error}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={project.id} className="rounded-lg border border-gray-200 p-3 dark:border-neutral-700">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <a
                          href={project.web_url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-sm font-semibold text-gray-900 hover:text-violet-700 dark:text-white dark:hover:text-violet-300"
                        >
                          {project.path_with_namespace}
                        </a>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {projectStatus.trains.length === 0
                            ? 'Train clear'
                            : `${projectStatus.trains.length} in active train`}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                        projectStatus.trains.length > 0
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                      }`}>
                        {projectStatus.trains.length > 0 ? 'Busy' : 'Clear'}
                      </span>
                    </div>

                    {projectStatus.trains.length > 0 && (
                      <div className="space-y-2">
                        {projectStatus.trains.map((train, index) => renderTrain(train, index))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {lastUpdated && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <RefreshCcw className="h-3.5 w-3.5" />
              Updated {formatRelativeTime(lastUpdated)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

