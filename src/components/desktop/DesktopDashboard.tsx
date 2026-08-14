'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  GitBranch,
  GitPullRequest,
  Inbox,
  Layers3,
  PenLine,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound
} from 'lucide-react';
import type {
  DashboardView,
  DesktopBootstrap,
  DesktopReview,
  DesktopSettings,
  ReviewDashboard,
  ReviewReadiness
} from '@desktop/contracts';
import type { RecentDesktopReview } from '@/desktop/storage';

type ReadinessFilter = 'all' | ReviewReadiness;

type DesktopDashboardProps = {
  bootstrap: DesktopBootstrap;
  settings: DesktopSettings;
  view: DashboardView;
  dashboard: ReviewDashboard | null;
  loading: boolean;
  error: string | null;
  recentReviews: RecentDesktopReview[];
  onViewChange: (view: DashboardView) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenReview: (review: DesktopReview) => void;
  onAgentChange: (kind: 'codex' | 'claude') => void;
};

const viewMeta: Record<DashboardView, { label: string; title: string; description: string; icon: typeof Inbox }> = {
  'review-requested': {
    label: 'Review requests',
    title: 'Waiting for your review',
    description: 'Open merge requests where GitLab has named you as a reviewer.',
    icon: Inbox
  },
  assigned: {
    label: 'Assigned to me',
    title: 'Assigned merge requests',
    description: 'Open work assigned to you, whether or not you are the reviewer.',
    icon: UserRound
  },
  authored: {
    label: 'Authored by me',
    title: 'Your open merge requests',
    description: 'Keep an eye on feedback and readiness across work you opened.',
    icon: PenLine
  },
  'all-open': {
    label: 'All open',
    title: 'All open merge requests',
    description: 'A broad view across projects accessible through your GitLab account.',
    icon: Layers3
  }
};

const readinessMeta: Record<ReviewReadiness, { dot: string; classes: string }> = {
  ready: { dot: 'bg-emerald-500', classes: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  draft: { dot: 'bg-slate-400', classes: 'border-slate-200 bg-slate-100 text-slate-600' },
  blocked: { dot: 'bg-rose-500', classes: 'border-rose-200 bg-rose-50 text-rose-800' },
  checking: { dot: 'bg-amber-500', classes: 'border-amber-200 bg-amber-50 text-amber-800' }
};

const relativeTime = (value: string | number) => {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'recently';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';

const pipelineTone = (status: string | undefined) => {
  if (!status) return null;
  if (['success', 'passed'].includes(status)) return { label: 'Pipeline passed', classes: 'text-emerald-700' };
  if (['failed', 'canceled'].includes(status)) return { label: `Pipeline ${status}`, classes: 'text-rose-700' };
  return { label: `Pipeline ${status}`, classes: 'text-amber-700' };
};

function BrandMark() {
  return (
    <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 via-indigo-500 to-blue-600 shadow-[0_10px_30px_rgba(99,102,241,0.32)]">
      <span className="absolute inset-[5px] rotate-45 rounded-[5px] border border-white/50" />
      <span className="relative h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.18)]" />
    </span>
  );
}

function Avatar({ name, avatarUrl, small = false }: { name: string; avatarUrl?: string; small?: boolean }) {
  const size = small ? 'h-6 w-6 text-[9px]' : 'h-8 w-8 text-[10px]';
  return avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={avatarUrl} alt="" className={`${size} rounded-full border border-white object-cover shadow-sm`} />
  ) : (
    <span className={`${size} inline-flex shrink-0 items-center justify-center rounded-full border border-indigo-100 bg-indigo-50 font-bold text-indigo-700`}>{initials(name)}</span>
  );
}

function ReviewRow({ review, onOpen }: { review: DesktopReview; onOpen: () => void }) {
  const pipeline = pipelineTone(review.pipelineStatus);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full grid-cols-[minmax(0,1fr)_auto] gap-5 border-b border-slate-200/80 px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-white focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
    >
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{review.repository.pathWithNamespace}</span>
          <span className="shrink-0 rounded-md bg-slate-200/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">{review.numberLabel}</span>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${readinessMeta[review.readiness].classes}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${readinessMeta[review.readiness].dot}`} />
            {review.readinessLabel}
          </span>
        </span>
        <span className="mt-1.5 block truncate text-[15px] font-semibold tracking-[-0.01em] text-slate-900 group-hover:text-indigo-700">{review.title}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5"><Avatar name={review.author.name} avatarUrl={review.author.avatarUrl} small />{review.author.name}</span>
          <span className="inline-flex min-w-0 items-center gap-1"><GitBranch className="h-3 w-3" /><span className="max-w-48 truncate font-mono">{review.sourceBranch}</span><span>→</span><span className="max-w-32 truncate font-mono">{review.targetBranch}</span></span>
          {review.changesCount !== undefined && <span>{review.changesCount} files</span>}
          {pipeline && <span className={`inline-flex items-center gap-1 font-medium ${pipeline.classes}`}><CircleDashed className="h-3 w-3" />{pipeline.label}</span>}
        </span>
      </span>
      <span className="flex h-full items-center gap-3">
        <span className="text-right">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Updated</span>
          <span className="mt-1 block text-xs font-medium text-slate-600">{relativeTime(review.updatedAt)}</span>
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 shadow-sm transition-all group-hover:translate-x-0.5 group-hover:border-indigo-200 group-hover:text-indigo-600"><ChevronRight className="h-4 w-4" /></span>
      </span>
    </button>
  );
}

export default function DesktopDashboard({
  bootstrap,
  settings,
  view,
  dashboard,
  loading,
  error,
  recentReviews,
  onViewChange,
  onRefresh,
  onOpenSettings,
  onOpenReview,
  onAgentChange
}: DesktopDashboardProps) {
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('all');
  const [readiness, setReadiness] = useState<ReadinessFilter>('all');
  const reviews = useMemo(() => dashboard?.reviews ?? [], [dashboard]);
  const projects = useMemo(() => [...new Set(reviews.map((review) => review.repository.pathWithNamespace))].sort(), [reviews]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reviews.filter((review) => (
      (project === 'all' || review.repository.pathWithNamespace === project) &&
      (readiness === 'all' || review.readiness === readiness) &&
      (!query || [review.title, review.repository.pathWithNamespace, review.author.name, review.author.username, ...review.labels]
        .some((value) => value.toLowerCase().includes(query)))
    ));
  }, [project, readiness, reviews, search]);
  const readyCount = reviews.filter((review) => review.readiness === 'ready').length;
  const draftCount = reviews.filter((review) => review.readiness === 'draft').length;
  const blockedCount = reviews.filter((review) => review.readiness === 'blocked').length;
  const activeHarness = bootstrap.harnesses.find((harness) => harness.kind === settings.agent.kind);
  const activeSourceControl = bootstrap.sourceControls.find((sourceControl) => sourceControl.kind === settings.sourceControl);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0b0d12] pt-8 text-slate-100">
      <div className="desktop-drag-region fixed inset-x-0 top-0 z-50 h-8 bg-[#0b0d12]" />
      <aside className="flex w-[252px] shrink-0 flex-col border-r border-white/[0.07] bg-[#0b0d12] px-3 pb-3">
        <div className="flex items-center gap-3 px-3 pb-6 pt-4">
          <BrandMark />
          <span><span className="block text-sm font-semibold tracking-[-0.01em] text-white">ReviewFlow</span><span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Local review studio</span></span>
        </div>

        <nav className="space-y-1" aria-label="Merge request views">
          {(Object.keys(viewMeta) as DashboardView[]).map((item) => {
            const meta = viewMeta[item];
            const Icon = meta.icon;
            const active = view === item;
            return (
              <button key={item} type="button" onClick={() => onViewChange(item)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${active ? 'bg-white/[0.09] text-white shadow-sm' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'}`}>
                <Icon className={`h-4 w-4 ${active ? 'text-indigo-300' : 'text-slate-500'}`} />
                <span className="flex-1">{meta.label}</span>
                {active && dashboard && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-slate-300">{reviews.length}</span>}
              </button>
            );
          })}
        </nav>

        <div className="mt-7 px-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Recent reviews</p>
          <div className="mt-2 space-y-1.5">
            {recentReviews.slice(0, 4).map((recent) => {
              const available = reviews.find((review) => review.id && JSON.stringify(review.ref) === JSON.stringify(recent.ref));
              return (
                <button key={`${recent.repositoryPath}-${recent.ref.number}`} type="button" disabled={!available} onClick={() => available && onOpenReview(available)} className="block w-full rounded-lg px-2 py-1.5 text-left disabled:cursor-default enabled:hover:bg-white/[0.05]">
                  <span className="block truncate text-[11px] font-medium text-slate-400">{recent.title}</span>
                  <span className="mt-0.5 block truncate text-[9px] text-slate-600">{recent.repositoryPath} · {relativeTime(recent.updatedAt)}</span>
                </button>
              );
            })}
            {!recentReviews.length && <p className="py-2 text-[10px] leading-4 text-slate-600">Reviews you open will stay close at hand.</p>}
          </div>
        </div>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[10px] font-semibold text-slate-300"><Bot className="h-3.5 w-3.5 text-violet-300" />Local agent</span>
              <span className={`h-2 w-2 rounded-full ${activeHarness?.authenticated ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]' : 'bg-amber-400'}`} />
            </div>
            <select value={settings.agent.kind} onChange={(event) => onAgentChange(event.target.value as 'codex' | 'claude')} className="desktop-no-drag mt-2 w-full rounded-md border border-white/[0.08] bg-[#11141b] px-2 py-1.5 text-[11px] font-medium text-slate-200 outline-none focus:border-indigo-400">
              {bootstrap.harnesses.map((harness) => <option key={harness.kind} value={harness.kind}>{harness.label}{harness.authenticated ? '' : ' · disconnected'}</option>)}
            </select>
            <p className="mt-2 truncate text-[9px] text-slate-600">{activeHarness?.version ?? activeHarness?.authDescription ?? 'Harness unavailable'}</p>
          </div>
          <button type="button" onClick={onOpenSettings} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium text-slate-500 hover:bg-white/[0.05] hover:text-slate-300"><Settings className="h-3.5 w-3.5" />Connections & settings</button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto bg-[#f3f2ef] text-slate-950">
        <div className="mx-auto max-w-[1260px] px-8 pb-16 pt-7">
          <header className="flex items-start justify-between gap-8">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600"><GitPullRequest className="h-3.5 w-3.5" />{settings.sourceControl}</div>
              <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.035em] text-slate-950">{viewMeta[view].title}</h1>
              <p className="mt-1 text-sm text-slate-500">{viewMeta[view].description}</p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className={`mr-1 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold ${activeSourceControl?.executable.installed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${activeSourceControl?.executable.installed ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                {settings.hosts[settings.sourceControl]}
              </span>
              <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
              <button type="button" onClick={onOpenSettings} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-slate-300 hover:text-slate-900" aria-label="Open settings"><Settings className="h-4 w-4" /></button>
            </div>
          </header>

          <section className="mt-7 grid grid-cols-3 gap-3" aria-label="Review summary">
            {[
              { label: 'Ready to review', value: readyCount, icon: ShieldCheck, tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
              { label: 'Still in draft', value: draftCount, icon: Clock3, tone: 'text-slate-600 bg-white border-slate-200' },
              { label: 'Needs attention', value: blockedCount, icon: AlertTriangle, tone: 'text-rose-700 bg-rose-50 border-rose-100' }
            ].map(({ label, value, icon: Icon, tone }) => (
              <button key={label} type="button" onClick={() => setReadiness(label === 'Ready to review' ? 'ready' : label === 'Still in draft' ? 'draft' : 'blocked')} className={`flex items-center gap-3 rounded-xl border p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-transform hover:-translate-y-0.5 ${tone}`}>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/70"><Icon className="h-4 w-4" /></span>
                <span><strong className="block text-lg leading-none tracking-[-0.02em]">{value}</strong><span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.11em] opacity-70">{label}</span></span>
              </button>
            ))}
          </section>

          <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-[#f9f9f7] shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, project, author, or label…" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </label>
              <select value={project} onChange={(event) => setProject(event.target.value)} className="h-9 max-w-64 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 outline-none focus:border-indigo-400">
                <option value="all">All projects</option>
                {projects.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={readiness} onChange={(event) => setReadiness(event.target.value as ReadinessFilter)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 outline-none focus:border-indigo-400">
                <option value="all">Any readiness</option>
                <option value="ready">Ready</option>
                <option value="draft">Draft</option>
                <option value="blocked">Blocked</option>
                <option value="checking">Checking</option>
              </select>
            </div>

            <div className="min-h-72">
              {error && (
                <div className="m-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
                  <div><h2 className="text-sm font-semibold">Could not load this review queue</h2><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-rose-700">{error}</p><button type="button" onClick={onRefresh} className="mt-3 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white">Try again</button></div>
                </div>
              )}
              {!error && loading && !dashboard && (
                <div className="flex min-h-72 flex-col items-center justify-center text-center"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><RefreshCw className="h-5 w-5 animate-spin" /></span><p className="mt-4 text-sm font-semibold text-slate-700">Reading your GitLab review queue</p><p className="mt-1 text-xs text-slate-400">Using the account already connected to glab.</p></div>
              )}
              {!error && !loading && dashboard && filtered.map((review) => <ReviewRow key={review.id} review={review} onOpen={() => onOpenReview(review)} />)}
              {!error && !loading && dashboard && !filtered.length && (
                <div className="flex min-h-72 flex-col items-center justify-center px-8 text-center"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400"><CheckCircle2 className="h-5 w-5" /></span><h2 className="mt-4 text-sm font-semibold text-slate-800">Nothing in this view</h2><p className="mt-1 max-w-sm text-xs leading-5 text-slate-400">Your queue is clear, or the current search and readiness filters hide the available reviews.</p>{(search || project !== 'all' || readiness !== 'all') && <button type="button" onClick={() => { setSearch(''); setProject('all'); setReadiness('all'); }} className="mt-3 text-xs font-semibold text-indigo-600">Clear filters</button>}</div>
              )}
            </div>
            {dashboard && (
              <footer className="flex items-center justify-between border-t border-slate-200 bg-white/70 px-5 py-2.5 text-[10px] text-slate-400">
                <span>{filtered.length} of {reviews.length} merge requests</span>
                <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-violet-500" />Every guided review can use full local repository context</span>
              </footer>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
