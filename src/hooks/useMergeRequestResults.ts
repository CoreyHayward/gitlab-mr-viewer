'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GitLabService, type MergeRequestPageCursor } from '@/services/gitlab';
import type { FilterOptions, GitLabMergeRequest, GitLabProject } from '@/types/gitlab';

type UseMergeRequestResultsOptions = {
  service: GitLabService | null;
  selectedProjects: GitLabProject[];
  filters: FilterOptions;
  enabled: boolean;
};

export function useMergeRequestResults({ service, selectedProjects, filters, enabled }: UseMergeRequestResultsOptions) {
  const [mergeRequests, setMergeRequests] = useState<GitLabMergeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<MergeRequestPageCursor | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const nextCursorRef = useRef<MergeRequestPageCursor | null>(null);

  const load = useCallback(async (append = false) => {
    if (!service || !enabled) return;
    const cursor = append ? nextCursorRef.current : null;
    if (append && !cursor) return;

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(!append);
    setLoadingMore(append);
    setError(null);
    if (!append) {
      setWarnings([]);
      nextCursorRef.current = null;
      setNextCursor(null);
    }

    try {
      const result = selectedProjects.length === 0
        ? await service.getAllMergeRequests(filters, controller.signal, cursor)
        : selectedProjects.length === 1
          ? await service.getMergeRequests(selectedProjects[0].id, filters, controller.signal, cursor)
          : await service.getMergeRequestsForProjects(selectedProjects.map((project) => project.id), filters, controller.signal, cursor);
      if (controller.signal.aborted) return;

      const detailWarnings: string[] = [];
      const enrichedPage = await service.enrichMergeRequestsWithDetails(
        result.mergeRequests,
        controller.signal,
        false,
        detailWarnings
      );
      if (controller.signal.aborted) return;

      const pageWarnings = [
        ...result.warnings,
        ...detailWarnings
      ];

      setMergeRequests((current) => {
        if (!append) return enrichedPage;
        const byId = new Map(current.map((mergeRequest) => [mergeRequest.id, mergeRequest]));
        enrichedPage.forEach((mergeRequest) => byId.set(mergeRequest.id, mergeRequest));
        return Array.from(byId.values()).sort((left, right) => {
          const leftTimestamp = filters.mergedAfter ? left.merged_at ?? left.updated_at : left.updated_at;
          const rightTimestamp = filters.mergedAfter ? right.merged_at ?? right.updated_at : right.updated_at;
          return new Date(rightTimestamp).getTime() - new Date(leftTimestamp).getTime();
        });
      });
      nextCursorRef.current = result.nextCursor;
      setNextCursor(result.nextCursor);
      setWarnings((current) => Array.from(new Set(append ? [...current, ...pageWarnings] : pageWarnings)));
    } catch (loadError) {
      if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load merge requests');
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [enabled, filters, selectedProjects, service]);

  const reset = useCallback(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    nextCursorRef.current = null;
    setMergeRequests([]);
    setNextCursor(null);
    setWarnings([]);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  return {
    mergeRequests,
    loading,
    loadingMore,
    error,
    warnings,
    hasMore: nextCursor !== null,
    load,
    reset
  };
}
