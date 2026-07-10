'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCcw } from 'lucide-react';

const AUTO_REFRESH_POPOVER_DELAY_MS = 3_000;

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
  const openTimerRef = useRef<number | null>(null);

  const clearOpenTimer = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };

  const schedulePopoverOpen = () => {
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      setIsPopoverOpen(true);
      openTimerRef.current = null;
    }, AUTO_REFRESH_POPOVER_DELAY_MS);
  };

  const closePopover = () => {
    clearOpenTimer();
    setIsPopoverOpen(false);
  };

  useEffect(() => clearOpenTimer, []);

  return (
    <div
      className="relative"
      onMouseEnter={schedulePopoverOpen}
      onMouseLeave={closePopover}
      onFocus={() => {
        clearOpenTimer();
        setIsPopoverOpen(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closePopover();
      }}
    >
      <button type="button" onClick={onRefresh} disabled={loading} className={className}>
        <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Refreshing...' : 'Refresh'}
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
