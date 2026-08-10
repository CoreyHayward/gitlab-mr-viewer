'use client';

import { useState } from 'react';
import { ChevronDown, RefreshCcw } from 'lucide-react';

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
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  return (
    <div
      className="relative flex items-center gap-1"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsPopoverOpen(false);
      }}
    >
      <button type="button" onClick={onRefresh} disabled={loading} className={className}>
        <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Refreshing...' : 'Refresh'}
      </button>
      <button
        type="button"
        onClick={() => setIsPopoverOpen((open) => !open)}
        aria-expanded={isPopoverOpen}
        aria-haspopup="true"
        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2.5 text-xs font-semibold text-gray-600 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-200 dark:hover:bg-neutral-700"
      >
        Auto {autoRefreshEnabled ? 'on' : 'off'}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isPopoverOpen ? 'rotate-180' : ''}`} />
      </button>
      {isPopoverOpen && (
        <label className="absolute right-0 top-full z-40 mt-1 flex w-52 items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-200">
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
      )}
    </div>
  );
}
