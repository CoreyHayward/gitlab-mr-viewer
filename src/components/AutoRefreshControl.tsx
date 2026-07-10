'use client';

import { RefreshCcw } from 'lucide-react';

interface AutoRefreshControlProps {
  loading: boolean;
  onRefresh: () => void;
  autoRefreshEnabled: boolean;
  onAutoRefreshEnabledChange: (enabled: boolean) => void;
  className: string;
}

export default function AutoRefreshControl({
  loading,
  onRefresh,
  autoRefreshEnabled,
  onAutoRefreshEnabledChange,
  className
}: AutoRefreshControlProps) {
  return (
    <div className="group relative">
      <button type="button" onClick={onRefresh} disabled={loading} className={className}>
        <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Refreshing...' : 'Refresh'}
      </button>
      <label className="pointer-events-none absolute right-0 top-full z-40 mt-1 flex w-52 items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 opacity-0 shadow-lg transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-200">
        <input
          type="checkbox"
          checked={autoRefreshEnabled}
          onChange={(event) => onAutoRefreshEnabledChange(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 dark:border-neutral-600 dark:bg-neutral-700"
        />
        <span>
          <span className="block font-medium">Auto-refresh</span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">Every minute when idle</span>
        </span>
      </label>
    </div>
  );
}
