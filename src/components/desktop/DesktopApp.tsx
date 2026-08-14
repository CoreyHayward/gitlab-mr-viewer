'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import type {
  AgentKind,
  DashboardView,
  DesktopBootstrap,
  DesktopReview,
  DesktopSettings,
  ReviewDashboard,
  UpdateSettingsRequest
} from '@desktop/contracts';
import DesktopDashboard from '@/components/desktop/DesktopDashboard';
import DesktopReviewWorkspace from '@/components/desktop/DesktopReviewWorkspace';
import DesktopSettingsDialog from '@/components/desktop/DesktopSettingsDialog';
import {
  readRecentDesktopReviews,
  touchRecentDesktopReview,
  type RecentDesktopReview
} from '@/desktop/storage';

const operationId = () => crypto.randomUUID();

const messageFrom = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'The desktop operation could not be completed.';
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
    .replace(/^Error:\s*/i, '');
};

function DesktopBoot({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-[#0b0d12] px-6 pt-8 text-slate-100">
      <div className="desktop-drag-region fixed inset-x-0 top-0 h-8" />
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-white/[0.035] p-7 text-center shadow-2xl">
        <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${error ? 'bg-rose-500/10 text-rose-300' : 'bg-indigo-500/10 text-indigo-300'}`}>{error ? <AlertTriangle className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}</span>
        <h1 className="mt-5 text-lg font-semibold text-white">{error ? 'ReviewFlow could not start' : 'Opening ReviewFlow'}</h1>
        <p className="mt-2 text-xs leading-5 text-slate-500">{error ?? 'Discovering source-control tools and the agent harnesses already authenticated on this Mac.'}</p>
        {!error && <Loader2 className="mx-auto mt-5 h-4 w-4 animate-spin text-indigo-300" />}
        {error && onRetry && <button type="button" onClick={onRetry} className="mt-5 rounded-lg bg-indigo-500 px-4 py-2 text-xs font-semibold text-white">Try again</button>}
      </div>
    </div>
  );
}

export default function DesktopApp() {
  const api = window.reviewflowDesktop!;
  const [bootstrap, setBootstrap] = useState<DesktopBootstrap | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [view, setView] = useState<DashboardView>('review-requested');
  const [dashboard, setDashboard] = useState<ReviewDashboard | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [review, setReview] = useState<DesktopReview | null>(null);
  const [recentReviews, setRecentReviews] = useState<RecentDesktopReview[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const dashboardOperationRef = useRef<string | null>(null);

  const loadBootstrap = useCallback(async () => {
    setBootstrapError(null);
    try {
      const next = await api.bootstrap();
      setBootstrap(next);
      setSettings(next.settings);
      setView(next.settings.defaultView);
      return next;
    } catch (error) {
      setBootstrapError(messageFrom(error));
      throw error;
    }
  }, [api]);

  useEffect(() => {
    document.title = 'ReviewFlow';
    setRecentReviews(readRecentDesktopReviews());
    void loadBootstrap().catch(() => undefined);
  }, [loadBootstrap]);

  useEffect(() => {
    if (!settings || !bootstrap) return;
    const sourceControl = bootstrap.sourceControls.find((candidate) => candidate.kind === settings.sourceControl);
    if (!sourceControl?.implemented) {
      setDashboard(null);
      setDashboardError(`${sourceControl?.label ?? settings.sourceControl} support is not included in this build yet.`);
      return;
    }

    if (dashboardOperationRef.current) void api.cancelOperation(dashboardOperationRef.current).catch(() => undefined);
    const currentOperation = operationId();
    dashboardOperationRef.current = currentOperation;
    setLoadingDashboard(true);
    setDashboardError(null);
    void api.listReviews({
      sourceControl: settings.sourceControl,
      host: settings.hosts[settings.sourceControl],
      view,
      operationId: currentOperation
    }).then((result) => {
      if (dashboardOperationRef.current === currentOperation) setDashboard(result);
    }).catch((error) => {
      if (dashboardOperationRef.current === currentOperation) setDashboardError(messageFrom(error));
    }).finally(() => {
      if (dashboardOperationRef.current === currentOperation) {
        dashboardOperationRef.current = null;
        setLoadingDashboard(false);
      }
    });

    return () => {
      if (dashboardOperationRef.current === currentOperation) {
        void api.cancelOperation(currentOperation).catch(() => undefined);
        dashboardOperationRef.current = null;
      }
    };
  }, [api, bootstrap, refreshVersion, settings, view]);

  const changeView = (nextView: DashboardView) => {
    setView(nextView);
    if (!settings) return;
    const optimistic = { ...settings, defaultView: nextView };
    setSettings(optimistic);
    void api.updateSettings({ defaultView: nextView }).then(setSettings).catch(() => setSettings(settings));
  };

  const changeAgent = (kind: AgentKind) => {
    if (!settings) return;
    const nextAgent = { kind, ...(settings.agent.model ? { model: settings.agent.model } : {}) };
    const optimistic = { ...settings, agent: nextAgent };
    setSettings(optimistic);
    void api.updateSettings({ agent: nextAgent }).then(setSettings).catch(() => setSettings(settings));
  };

  const saveSettings = async (request: UpdateSettingsRequest) => {
    const next = await api.updateSettings(request);
    setSettings(next);
    setView(next.defaultView);
    setDashboard(null);
    setRefreshVersion((value) => value + 1);
  };

  const openReview = (nextReview: DesktopReview) => {
    setRecentReviews(touchRecentDesktopReview(nextReview));
    setReview(nextReview);
  };

  if (bootstrapError && !bootstrap) return <DesktopBoot error={bootstrapError} onRetry={() => void loadBootstrap().catch(() => undefined)} />;
  if (!bootstrap || !settings) return <DesktopBoot />;

  const harness = bootstrap.harnesses.find((candidate) => candidate.kind === settings.agent.kind);

  return (
    <>
      {review ? (
        <DesktopReviewWorkspace
          review={review}
          agent={settings.agent}
          harness={harness}
          onBack={() => { setReview(null); setRefreshVersion((value) => value + 1); }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <DesktopDashboard
          bootstrap={bootstrap}
          settings={settings}
          view={view}
          dashboard={dashboard}
          loading={loadingDashboard}
          error={dashboardError}
          recentReviews={recentReviews}
          onViewChange={changeView}
          onRefresh={() => setRefreshVersion((value) => value + 1)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenReview={openReview}
          onAgentChange={changeAgent}
        />
      )}
      <DesktopSettingsDialog
        open={settingsOpen}
        bootstrap={bootstrap}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        onRescan={async () => { await loadBootstrap(); }}
      />
    </>
  );
}
