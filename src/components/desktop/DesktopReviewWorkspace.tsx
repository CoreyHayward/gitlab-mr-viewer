'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  ExternalLink,
  FileCode2,
  Flag,
  FolderGit2,
  Loader2,
  LockKeyhole,
  MessageSquare,
  RefreshCw,
  Settings,
  ShieldAlert,
  Sparkles,
  X
} from 'lucide-react';
import type {
  AgentAnswer,
  AgentReviewOutline,
  AgentSelection,
  AutomatedReview,
  DesktopReview,
  HarnessStatus,
  LocalReviewInput,
  ReviewFinding
} from '@desktop/contracts';
import DesktopDiffFile from '@/components/desktop/DesktopDiffFile';
import { reconcileSavedReviewState } from '@/review/delta';
import { createHeuristicReview, normaliseAiReview } from '@/review/organizeReview';
import type {
  ReviewFileChange,
  ReviewStatus,
  SavedReviewState,
  SemanticReview
} from '@/review/types';
import {
  readDesktopReview,
  writeDesktopReview,
  type DesktopSavedReview
} from '@/desktop/storage';

type DesktopReviewWorkspaceProps = {
  review: DesktopReview;
  agent: AgentSelection;
  harness?: HarnessStatus;
  onBack: () => void;
  onOpenSettings: () => void;
};

type OutlineSource = 'agent' | 'cached-agent' | 'local';

type ReviewSession = {
  input: LocalReviewInput;
  review: SemanticReview;
  rawOutline?: AgentReviewOutline;
  outlineSource: OutlineSource;
  state: SavedReviewState;
  automatedReview?: AutomatedReview;
};

const statusMeta: Record<ReviewStatus, { label: string; dot: string; classes: string }> = {
  'not-started': { label: 'Not read', dot: 'bg-slate-600', classes: 'border-white/10 bg-white/[0.04] text-slate-400' },
  'in-progress': { label: 'Reading', dot: 'bg-blue-400', classes: 'border-blue-400/20 bg-blue-400/10 text-blue-200' },
  reviewed: { label: 'Reviewed', dot: 'bg-emerald-400', classes: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' },
  'needs-look': { label: 'Flagged', dot: 'bg-amber-400', classes: 'border-amber-400/20 bg-amber-400/10 text-amber-200' },
  blocked: { label: 'Blocking', dot: 'bg-rose-400', classes: 'border-rose-400/20 bg-rose-400/10 text-rose-200' },
  stale: { label: 'Changed', dot: 'bg-violet-400', classes: 'border-violet-400/20 bg-violet-400/10 text-violet-200' }
};

const riskMeta = {
  low: { label: 'Quick skim', classes: 'border-slate-200 bg-slate-100 text-slate-600' },
  medium: { label: 'Worth a check', classes: 'border-amber-200 bg-amber-50 text-amber-800' },
  high: { label: 'Look closely', classes: 'border-rose-200 bg-rose-50 text-rose-800' }
};

const severityMeta: Record<ReviewFinding['severity'], { label: string; classes: string }> = {
  critical: { label: 'Critical', classes: 'border-rose-300 bg-rose-100 text-rose-900' },
  high: { label: 'High', classes: 'border-orange-300 bg-orange-100 text-orange-900' },
  medium: { label: 'Medium', classes: 'border-amber-300 bg-amber-100 text-amber-900' },
  low: { label: 'Low', classes: 'border-blue-300 bg-blue-100 text-blue-900' }
};

const messageFrom = (error: unknown) => (error instanceof Error ? error.message : 'This local review operation could not be completed.')
  .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
  .replace(/^Error:\s*/i, '');

const isTypingTarget = (target: EventTarget | null) => (
  target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
);

const reviewChangesFrom = (input: LocalReviewInput): ReviewFileChange[] => input.changes.map((change) => ({
  path: change.path,
  ...(change.oldPath ? { oldPath: change.oldPath } : {}),
  kind: change.kind,
  diff: change.diff
}));

const reviewDelta = (saved: DesktopSavedReview | null, input: LocalReviewInput) => {
  if (!saved) return { state: 'first-review' as const, summary: ['This is your first local review of this change.'], changedPaths: [], newPaths: [] };
  if (saved.headSha === input.headSha) return { state: 'unchanged' as const, summary: ['The merge request has not changed since your saved review.'], changedPaths: [], newPaths: [] };
  return {
    state: 'updated' as const,
    summary: ['A new head commit landed since your saved review.', 'Previously reviewed concepts are marked stale until you revisit them.'],
    changedPaths: [],
    newPaths: []
  };
};

const semanticReviewFrom = (input: LocalReviewInput, outline?: AgentReviewOutline) => {
  const changes = reviewChangesFrom(input);
  const fallback = createHeuristicReview(input.review.title, changes, input.review.description);
  if (!outline) return fallback;
  try {
    return normaliseAiReview(outline, fallback, changes);
  } catch {
    return fallback;
  }
};

const sessionFrom = (input: LocalReviewInput, saved: DesktopSavedReview | null): ReviewSession => {
  const sameHead = saved?.headSha === input.headSha;
  const rawOutline = sameHead ? saved?.outline : undefined;
  const review = semanticReviewFrom(input, rawOutline);
  const state = reconcileSavedReviewState(review.sections, saved ? {
    statuses: saved.statuses,
    notes: saved.notes,
    selectedSectionId: saved.selectedSectionId
  } : undefined, reviewDelta(saved, input));
  return {
    input,
    review,
    ...(rawOutline ? { rawOutline } : {}),
    outlineSource: rawOutline ? 'cached-agent' : 'local',
    state,
    ...(sameHead && saved?.automatedReview ? { automatedReview: saved.automatedReview } : {})
  };
};

const statusOf = (session: ReviewSession, sectionId: string): ReviewStatus => session.state.statuses[sectionId] ?? 'not-started';

const formatDuration = (durationMs: number) => durationMs < 1_000 ? `${durationMs}ms` : `${(durationMs / 1_000).toFixed(1)}s`;

function WorkspaceHeader({
  review,
  harness,
  agent,
  organizing,
  onBack,
  onOpenSettings,
  onReveal,
  onOpenExternal
}: DesktopReviewWorkspaceProps & {
  organizing: boolean;
  onReveal: () => void;
  onOpenExternal: () => void;
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-white/[0.07] bg-[#0b0d12] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white" aria-label="Back to dashboard"><ArrowLeft className="h-4 w-4" /></button>
        <span className="h-5 w-px bg-white/10" />
        <span className="min-w-0"><span className="block truncate text-xs font-semibold text-white">{review.title}</span><span className="mt-0.5 flex items-center gap-2 truncate text-[9px] font-medium uppercase tracking-[0.12em] text-slate-600"><span>{review.repository.pathWithNamespace} {review.numberLabel}</span><span>·</span><span className="normal-case tracking-normal">{review.sourceBranch} → {review.targetBranch}</span></span></span>
      </div>
      <div className="flex items-center gap-2">
        {organizing && <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/15 bg-violet-400/[0.07] px-2.5 py-1 text-[9px] font-semibold text-violet-200"><Loader2 className="h-3 w-3 animate-spin" />Agent organizing</span>}
        <button type="button" onClick={onReveal} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 text-[10px] font-semibold text-slate-400 hover:bg-white/[0.05] hover:text-white"><FolderGit2 className="h-3.5 w-3.5" />Worktree</button>
        <button type="button" onClick={onOpenExternal} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 text-[10px] font-semibold text-slate-400 hover:bg-white/[0.05] hover:text-white"><ExternalLink className="h-3.5 w-3.5" />GitLab</button>
        <span className="inline-flex h-8 items-center gap-2 rounded-full border border-white/10 px-3 text-[10px] font-semibold text-slate-300"><Bot className="h-3.5 w-3.5 text-violet-300" />{harness?.label ?? agent.kind}<span className={`h-1.5 w-1.5 rounded-full ${harness?.authenticated ? 'bg-emerald-400' : 'bg-amber-400'}`} /></span>
        <button type="button" onClick={onOpenSettings} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white/[0.06] hover:text-white" aria-label="Open settings"><Settings className="h-4 w-4" /></button>
      </div>
    </header>
  );
}

function PreparingReview({ review, phase, error, onBack, onOpenSettings }: {
  review: DesktopReview;
  phase: 'worktree' | 'outline';
  error: string | null;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#0b0d12] pt-8 text-slate-100">
      <div className="desktop-drag-region fixed inset-x-0 top-0 z-50 h-8 bg-[#0b0d12]" />
      <header className="flex h-14 items-center gap-3 border-b border-white/[0.07] px-4"><button type="button" onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white"><ArrowLeft className="h-4 w-4" /></button><span className="h-5 w-px bg-white/10" /><span><span className="block text-xs font-semibold text-white">{review.title}</span><span className="mt-0.5 block text-[9px] uppercase tracking-[0.12em] text-slate-600">{review.repository.pathWithNamespace} {review.numberLabel}</span></span></header>
      <main className="flex min-h-[calc(100vh-5.5rem)] items-center justify-center p-8">
        <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-white/[0.035] p-8 shadow-2xl">
          <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${error ? 'bg-rose-400/10 text-rose-300' : 'bg-indigo-400/10 text-indigo-300'}`}>{error ? <AlertTriangle className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}</span>
          <h1 className="mt-5 text-center text-lg font-semibold text-white">{error ? 'Could not prepare this review' : phase === 'worktree' ? 'Building local review context' : 'Constructing the walkthrough'}</h1>
          <p className={`mt-2 text-center text-xs leading-5 ${error ? 'text-rose-200' : 'text-slate-500'}`}>{error ?? (phase === 'worktree' ? 'ReviewFlow is refreshing the repository and checking out the exact review head in a managed detached worktree.' : 'Your selected local agent is grouping the code into a useful review sequence. The repository remains read-only.')}</p>
          {!error && <ol className="mt-6 space-y-2 text-[11px] text-slate-400">{[
            ['Fetch exact source-control refs', true],
            ['Build bounded local diff', phase === 'outline'],
            ['Inspect repository with local agent', false]
          ].map(([label, done], index) => <li key={String(label)} className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.025] px-3 py-2"><span className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${done ? 'bg-emerald-400/15 text-emerald-300' : index === (phase === 'worktree' ? 0 : 2) ? 'bg-indigo-400/15 text-indigo-300' : 'bg-white/[0.05] text-slate-600'}`}>{done ? <Check className="h-3 w-3" /> : index + 1}</span>{label}</li>)}</ol>}
          {error && <div className="mt-5 flex justify-center gap-2"><button type="button" onClick={onBack} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300">Back to queue</button><button type="button" onClick={onOpenSettings} className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white">Check connections</button></div>}
        </div>
      </main>
    </div>
  );
}

export default function DesktopReviewWorkspace({ review, agent, harness, onBack, onOpenSettings }: DesktopReviewWorkspaceProps) {
  const api = window.reviewflowDesktop!;
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [phase, setPhase] = useState<'worktree' | 'outline'>('worktree');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [automating, setAutomating] = useState(false);
  const [automatedError, setAutomatedError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AgentAnswer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [copiedFinding, setCopiedFinding] = useState<string | null>(null);
  const prepareOperationRef = useRef<string | null>(null);
  const outlineOperationRef = useRef<string | null>(null);
  const automatedOperationRef = useRef<string | null>(null);
  const askOperationRef = useRef<string | null>(null);
  const sessionRef = useRef<ReviewSession | null>(null);

  const applyOutline = useCallback((outline: AgentReviewOutline, source: OutlineSource) => {
    setSession((current) => {
      if (!current) return current;
      const nextReview = semanticReviewFrom(current.input, outline);
      const state = reconcileSavedReviewState(nextReview.sections, current.state, {
        state: 'unchanged', summary: [], changedPaths: [], newPaths: []
      });
      return { ...current, review: nextReview, rawOutline: outline, outlineSource: source, state };
    });
  }, []);

  const generateOutline = useCallback(async (input: LocalReviewInput, force = false) => {
    if (!harness?.authenticated) {
      if (force) onOpenSettings();
      return;
    }
    if (outlineOperationRef.current) await api.cancelOperation(outlineOperationRef.current).catch(() => undefined);
    const operationId = crypto.randomUUID();
    outlineOperationRef.current = operationId;
    setOrganizing(true);
    setNotice(null);
    try {
      const result = await api.generateOutline({ ...review.ref, operationId, agent });
      if (outlineOperationRef.current !== operationId) return;
      applyOutline(result.outline, 'agent');
      setNotice(`${harness.label} rebuilt the walkthrough in ${formatDuration(result.durationMs)} using the local repository.`);
    } catch (error) {
      if (outlineOperationRef.current !== operationId) return;
      const message = messageFrom(error);
      setNotice(/cancel/i.test(message) ? 'Agent organization was cancelled; the local walkthrough remains available.' : `Using the local walkthrough because the agent could not organize this review: ${message}`);
    } finally {
      if (outlineOperationRef.current === operationId) {
        outlineOperationRef.current = null;
        setOrganizing(false);
      }
    }
  }, [agent, api, applyOutline, harness, onOpenSettings, review.ref]);

  useEffect(() => {
    let active = true;
    const prepareOperation = crypto.randomUUID();
    prepareOperationRef.current = prepareOperation;
    setLoadError(null);
    setPhase('worktree');
    void api.prepareReview({ ...review.ref, operationId: prepareOperation })
      .then(async (input) => {
        if (!active || prepareOperationRef.current !== prepareOperation) return;
        prepareOperationRef.current = null;
        const saved = readDesktopReview(review.ref);
        const initial = sessionFrom(input, saved);
        setSession(initial);
        sessionRef.current = initial;
        if (initial.rawOutline) return;
        if (harness?.authenticated) {
          setPhase('outline');
          await generateOutline(input);
        } else {
          setNotice('Using ReviewFlow’s local semantic grouping. Connect Codex or Claude Code to build a repository-aware walkthrough.');
        }
      })
      .catch((error) => {
        if (active && prepareOperationRef.current === prepareOperation) setLoadError(messageFrom(error));
      });

    return () => {
      active = false;
      for (const operation of [prepareOperationRef, outlineOperationRef, automatedOperationRef, askOperationRef]) {
        if (operation.current) void api.cancelOperation(operation.current).catch(() => undefined);
        operation.current = null;
      }
    };
  }, [api, generateOutline, harness?.authenticated, review.ref]);

  useEffect(() => {
    if (!session) return;
    sessionRef.current = session;
    const timer = window.setTimeout(() => {
      const saved = writeDesktopReview(review.ref, {
        headSha: session.input.headSha,
        ...(session.rawOutline ? { outline: session.rawOutline } : {}),
        ...(session.automatedReview ? { automatedReview: session.automatedReview } : {}),
        statuses: session.state.statuses,
        notes: session.state.notes,
        selectedSectionId: session.state.selectedSectionId,
        updatedAt: Date.now()
      });
      if (!saved) setNotice((current) => current ?? 'This review is open, but local progress could not be saved.');
    }, 350);
    return () => window.clearTimeout(timer);
  }, [review.ref, session]);

  useEffect(() => () => {
    const current = sessionRef.current;
    if (!current) return;
    writeDesktopReview(review.ref, {
      headSha: current.input.headSha,
      ...(current.rawOutline ? { outline: current.rawOutline } : {}),
      ...(current.automatedReview ? { automatedReview: current.automatedReview } : {}),
      statuses: current.state.statuses,
      notes: current.state.notes,
      selectedSectionId: current.state.selectedSectionId,
      updatedAt: Date.now()
    });
  }, [review.ref]);

  const selected = useMemo(() => session?.review.sections.find((section) => section.id === session.state.selectedSectionId) ?? session?.review.sections[0], [session]);
  const selectedIndex = session && selected ? session.review.sections.findIndex((section) => section.id === selected.id) : -1;

  const selectSection = useCallback((sectionId: string) => {
    setSession((current) => current ? {
      ...current,
      state: {
        ...current.state,
        selectedSectionId: sectionId,
        statuses: {
          ...current.state.statuses,
          ...(current.state.statuses[sectionId] ? {} : { [sectionId]: 'in-progress' as const })
        }
      }
    } : current);
    setAnswer(null);
    setAskError(null);
  }, []);

  const setSectionStatus = useCallback((sectionId: string, status: ReviewStatus) => {
    setSession((current) => current ? {
      ...current,
      state: { ...current.state, statuses: { ...current.state.statuses, [sectionId]: status } }
    } : current);
  }, []);

  const moveNext = useCallback(() => {
    if (!session || !selected) return;
    const next = session.review.sections[selectedIndex + 1];
    setSession((current) => current ? {
      ...current,
      state: {
        ...current.state,
        statuses: { ...current.state.statuses, [selected.id]: 'reviewed' },
        selectedSectionId: next?.id ?? selected.id
      }
    } : current);
    setAnswer(null);
  }, [selected, selectedIndex, session]);

  useEffect(() => {
    if (!session || !selected) return;
    const handleKeys = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() === 'j') {
        event.preventDefault();
        const next = session.review.sections[selectedIndex + 1];
        if (next) selectSection(next.id);
      }
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const previous = session.review.sections[selectedIndex - 1];
        if (previous) selectSection(previous.id);
      }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); moveNext(); }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); setSectionStatus(selected.id, 'needs-look'); }
      if (event.key.toLowerCase() === 'b') { event.preventDefault(); setSectionStatus(selected.id, 'blocked'); }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [moveNext, selectSection, selected, selectedIndex, session, setSectionStatus]);

  const runAutomatedReview = async () => {
    if (!session) return;
    if (!harness?.authenticated) { onOpenSettings(); return; }
    if (automatedOperationRef.current) {
      await api.cancelOperation(automatedOperationRef.current).catch(() => undefined);
      return;
    }
    const operationId = crypto.randomUUID();
    automatedOperationRef.current = operationId;
    setAutomating(true);
    setAutomatedError(null);
    try {
      const result = await api.runAutomatedReview({ ...review.ref, operationId, agent });
      if (automatedOperationRef.current !== operationId) return;
      setSession((current) => current ? { ...current, automatedReview: result.review } : current);
      setNotice(`${harness.label} completed an evidence-led review in ${formatDuration(result.durationMs)}. Verify every candidate before acting.`);
    } catch (error) {
      if (automatedOperationRef.current === operationId) setAutomatedError(messageFrom(error));
    } finally {
      if (automatedOperationRef.current === operationId) {
        automatedOperationRef.current = null;
        setAutomating(false);
      }
    }
  };

  const askAgent = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || !selected || !question.trim()) return;
    if (!harness?.authenticated) { onOpenSettings(); return; }
    if (askOperationRef.current) await api.cancelOperation(askOperationRef.current).catch(() => undefined);
    const operationId = crypto.randomUUID();
    askOperationRef.current = operationId;
    setAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      const result = await api.askAgent({
        ...review.ref,
        operationId,
        agent,
        question: question.trim(),
        section: {
          title: selected.title,
          intent: selected.intent,
          reviewFocus: selected.reviewFocus,
          filePaths: selected.filePaths
        }
      });
      if (askOperationRef.current === operationId) setAnswer(result.response);
    } catch (error) {
      if (askOperationRef.current === operationId) setAskError(messageFrom(error));
    } finally {
      if (askOperationRef.current === operationId) {
        askOperationRef.current = null;
        setAsking(false);
      }
    }
  };

  const openFinding = (finding: ReviewFinding) => {
    if (!session) return;
    const section = session.review.sections.find((candidate) => candidate.filePaths.includes(finding.filePath));
    if (section) selectSection(section.id);
    window.setTimeout(() => document.getElementById(`desktop-file-${encodeURIComponent(finding.filePath)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const copyFinding = async (finding: ReviewFinding) => {
    try {
      await navigator.clipboard.writeText(finding.suggestedComment);
      setCopiedFinding(finding.id);
      window.setTimeout(() => setCopiedFinding(null), 1_500);
    } catch {
      setAutomatedError('Clipboard access is unavailable. Select and copy the suggested comment manually.');
    }
  };

  if (!session) return <PreparingReview review={review} phase={phase} error={loadError} onBack={onBack} onOpenSettings={onOpenSettings} />;
  if (!selected) return <PreparingReview review={review} phase="outline" error="No reviewable concepts were produced for this change." onBack={onBack} onOpenSettings={onOpenSettings} />;

  const reviewedCount = session.review.sections.filter((section) => statusOf(session, section.id) === 'reviewed').length;
  const progress = session.review.sections.length ? Math.round((reviewedCount / session.review.sections.length) * 100) : 0;
  const findings = session.automatedReview?.findings ?? [];
  const findingsForSelected = findings.filter((finding) => selected.filePaths.includes(finding.filePath));

  return (
    <div className="h-screen overflow-hidden bg-[#0b0d12] pt-8 text-slate-100">
      <div className="desktop-drag-region fixed inset-x-0 top-0 z-50 h-8 bg-[#0b0d12]" />
      <WorkspaceHeader review={review} agent={agent} harness={harness} onBack={onBack} onOpenSettings={onOpenSettings} organizing={organizing} onReveal={() => void api.revealWorktree(review.ref)} onOpenExternal={() => void api.openExternal(review.webUrl)} />

      <div className="grid h-[calc(100vh-5.5rem)] grid-cols-[260px_minmax(500px,1fr)_360px]">
        <nav className="flex min-h-0 flex-col border-r border-white/[0.07] bg-[#0c0f14]" aria-label="Review concepts">
          <div className="border-b border-white/[0.07] px-4 py-4">
            <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600"><span>Review progress</span><span className="text-slate-400">{reviewedCount}/{session.review.sections.length}</span></div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-400 transition-all" style={{ width: `${progress}%` }} /></div>
            <div className="mt-3 flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-[9px] text-slate-500"><Sparkles className="h-3 w-3 text-violet-400" />{session.outlineSource === 'agent' ? harness?.label : session.outlineSource === 'cached-agent' ? 'Saved agent outline' : 'Local outline'}</span><button type="button" onClick={() => void generateOutline(session.input, true)} disabled={organizing} className="rounded p-1 text-slate-600 hover:bg-white/[0.05] hover:text-slate-300 disabled:opacity-50" aria-label="Regenerate walkthrough"><RefreshCw className={`h-3 w-3 ${organizing ? 'animate-spin' : ''}`} /></button></div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {session.review.sections.map((section, index) => {
              const status = statusOf(session, section.id);
              const active = section.id === selected.id;
              return (
                <button key={section.id} type="button" onClick={() => selectSection(section.id)} className={`mb-1 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${active ? 'bg-white/[0.085] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}`}>
                  <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-[9px] font-bold text-slate-500"><span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-[#0c0f14] ${statusMeta[status].dot}`} />{index + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block text-[11px] font-semibold leading-4">{section.title}</span><span className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-600"><FileCode2 className="h-2.5 w-2.5" />{section.files.length} {section.files.length === 1 ? 'file' : 'files'}<span>·</span><span className={section.risk === 'high' ? 'text-rose-400' : section.risk === 'medium' ? 'text-amber-400' : ''}>{section.risk}</span></span></span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-white/[0.07] p-3 text-[9px] leading-4 text-slate-600"><LockKeyhole className="mr-1 inline h-3 w-3" />Notes and progress stay on this Mac. Agent guidance is never posted automatically.</div>
        </nav>

        <main className="relative min-w-0 overflow-y-auto bg-[#f3f2ef] text-slate-950">
          <div className="mx-auto max-w-[1050px] px-7 pb-24 pt-6">
            {notice && <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-[11px] leading-5 text-indigo-900"><span className="flex items-start gap-2"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />{notice}</span><button type="button" onClick={() => setNotice(null)} className="rounded p-0.5 text-indigo-400 hover:text-indigo-700"><X className="h-3.5 w-3.5" /></button></div>}
            {session.input.diffTruncated && <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />Some on-screen patches were bounded for responsiveness. The agent works from the checked-out repository and can inspect code beyond this display.</div>}

            <details className="mb-4 rounded-xl border border-slate-200 bg-white/80 shadow-sm">
              <summary className="cursor-pointer list-none px-4 py-3"><span className="flex items-center justify-between gap-4"><span><span className="block text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400">Review overview</span><span className="mt-1 block text-sm font-semibold text-slate-900">{session.review.overview.purpose}</span></span><ChevronRight className="h-4 w-4 text-slate-400" /></span></summary>
              <div className="grid gap-3 border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-600 md:grid-cols-2"><div><strong className="text-slate-800">Scope</strong><p className="mt-1">{session.review.overview.scope}</p></div><div><strong className="text-slate-800">Attention</strong><p className="mt-1">{session.review.overview.riskSummary}</p></div></div>
            </details>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_40px_rgba(15,23,42,0.05)]">
              <div className="flex items-start justify-between gap-5"><div><span className="text-[10px] font-bold uppercase tracking-[0.15em] text-indigo-600">Concept {selectedIndex + 1} of {session.review.sections.length}</span><h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-slate-950">{selected.title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{selected.intent}</p></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${riskMeta[selected.risk].classes}`}>{riskMeta[selected.risk].label}</span></div>
              <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3.5"><span className="text-[9px] font-bold uppercase tracking-[0.14em] text-indigo-500">What to check</span><p className="mt-1 text-xs leading-5 text-indigo-950">{selected.reviewFocus}</p></div>
            </section>

            <div className="mt-5 space-y-4">
              {selected.files.map((file) => {
                const local = session.input.changes.find((change) => change.path === file.path);
                return <DesktopDiffFile key={file.path} file={file} diffTruncated={local?.diffTruncated} findings={findings.filter((finding) => finding.filePath === file.path)} />;
              })}
            </div>
          </div>

          <div className="sticky bottom-0 z-20 flex h-14 items-center justify-between border-t border-slate-200 bg-white/95 px-5 shadow-[0_-10px_30px_rgba(15,23,42,0.06)] backdrop-blur">
            <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusMeta[statusOf(session, selected.id)].classes}`}><span className={`h-1.5 w-1.5 rounded-full ${statusMeta[statusOf(session, selected.id)].dot}`} />{statusMeta[statusOf(session, selected.id)].label}</span>
            <span className="flex items-center gap-1.5">
              <button type="button" disabled={selectedIndex <= 0} onClick={() => selectSection(session.review.sections[selectedIndex - 1].id)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /><kbd>K</kbd></button>
              <button type="button" disabled={selectedIndex >= session.review.sections.length - 1} onClick={() => selectSection(session.review.sections[selectedIndex + 1].id)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-30"><kbd>J</kbd><ChevronRight className="h-3.5 w-3.5" /></button>
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <button type="button" onClick={() => setSectionStatus(selected.id, 'needs-look')} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-50"><Flag className="h-3.5 w-3.5" /><kbd>F</kbd> Flag</button>
              <button type="button" onClick={() => setSectionStatus(selected.id, 'blocked')} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-50"><ShieldAlert className="h-3.5 w-3.5" /><kbd>B</kbd> Block</button>
              <button type="button" onClick={moveNext} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[10px] font-semibold text-white shadow-sm hover:bg-indigo-700"><Check className="h-3.5 w-3.5" /><kbd>R</kbd> Reviewed</button>
            </span>
          </div>
        </main>

        <aside className="min-h-0 overflow-y-auto border-l border-white/[0.07] bg-[#0d1016] p-4">
          <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
            <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"><MessageSquare className="h-3.5 w-3.5 text-violet-300" />Ask about this code</h2><span className="text-[9px] text-slate-600">{harness?.label ?? agent.kind}</span></div>
            <form onSubmit={askAgent} className="mt-3">
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder="What calls this? Is the failure path covered?" className="w-full resize-none rounded-lg border border-white/[0.09] bg-[#080a0e] px-3 py-2 text-[11px] leading-5 text-slate-200 outline-none placeholder:text-slate-700 focus:border-violet-400/60" />
              <div className="mt-2 flex justify-end"><button type="submit" disabled={asking || !question.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-violet-400 disabled:opacity-40">{asking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}{asking ? 'Investigating…' : harness?.authenticated ? 'Ask agent' : 'Connect agent'}</button></div>
            </form>
            <div className="mt-3 flex flex-wrap gap-1.5">{selected.prompts.slice(0, 3).map((prompt) => <button key={prompt} type="button" onClick={() => setQuestion(prompt)} className="rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1 text-left text-[9px] leading-4 text-slate-500 hover:border-violet-400/20 hover:text-slate-300">{prompt}</button>)}</div>
            {(asking || answer || askError) && <div className={`mt-3 rounded-lg border p-3 ${askError ? 'border-rose-400/20 bg-rose-400/[0.07]' : 'border-violet-400/15 bg-violet-400/[0.06]'}`} aria-live="polite">{asking && !answer && <p className="text-[10px] leading-5 text-violet-200/70">Reading the repository and tracing relevant code…</p>}{askError && <p className="text-[10px] leading-5 text-rose-200">{askError}</p>}{answer && <><p className="whitespace-pre-wrap text-[11px] leading-5 text-slate-300">{answer.answer}</p>{answer.evidence.length > 0 && <ul className="mt-3 space-y-1.5 border-t border-white/[0.07] pt-2">{answer.evidence.map((evidence, index) => <li key={`${evidence.path}-${index}`} className="text-[9px] leading-4 text-slate-500"><code className="text-violet-200/80">{evidence.path}{evidence.line ? `:${evidence.line}` : ''}</code><span className="block">{evidence.reason}</span></li>)}</ul>}{answer.caveats.length > 0 && <p className="mt-2 text-[9px] leading-4 text-amber-200/60">{answer.caveats.join(' ')}</p>}</>}</div>}
          </section>

          <section className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
            <div className="flex items-center justify-between"><h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Private note</h2><span className="text-[9px] text-slate-600">Saved locally</span></div>
            <textarea value={session.state.notes[selected.id] ?? ''} onChange={(event) => setSession((current) => current ? { ...current, state: { ...current.state, notes: { ...current.state.notes, [selected.id]: event.target.value } } } : current)} rows={4} placeholder="Record an assumption, follow-up, or test to run…" className="mt-3 w-full resize-y rounded-lg border border-white/[0.08] bg-[#080a0e] px-3 py-2 text-[11px] leading-5 text-slate-300 outline-none placeholder:text-slate-700 focus:border-indigo-400/50" />
          </section>

          <section className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
            <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"><ShieldAlert className="h-3.5 w-3.5 text-amber-300" />Automated review</h2><p className="mt-1 text-[9px] leading-4 text-slate-600">Candidate defects for human verification—not verdicts.</p></div><button type="button" onClick={() => void runAutomatedReview()} className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[9px] font-semibold ${automating ? 'border border-rose-400/20 bg-rose-400/10 text-rose-200' : 'bg-amber-400 text-amber-950 hover:bg-amber-300'}`}>{automating ? <X className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}{automating ? 'Cancel' : findings.length ? 'Run again' : harness?.authenticated ? 'Run review' : 'Connect agent'}</button></div>
            {automatedError && <p className="mt-3 rounded-lg border border-rose-400/15 bg-rose-400/[0.07] p-2 text-[9px] leading-4 text-rose-200">{automatedError}</p>}
            {session.automatedReview && <div className="mt-3"><p className="text-[10px] leading-5 text-slate-400">{session.automatedReview.summary}</p>{findings.length === 0 ? <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-400/10 bg-emerald-400/[0.05] px-2.5 py-2 text-[9px] text-emerald-200/70"><Check className="h-3 w-3" />No candidate defects found. Continue the human review.</div> : <div className="mt-3 space-y-2">{findings.map((finding) => <article key={finding.id} className={`rounded-lg border p-2.5 ${selected.filePaths.includes(finding.filePath) ? 'border-amber-400/20 bg-amber-400/[0.06]' : 'border-white/[0.07] bg-black/10'}`}><button type="button" onClick={() => openFinding(finding)} className="block w-full text-left"><span className="flex items-center justify-between gap-2"><span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${severityMeta[finding.severity].classes}`}>{severityMeta[finding.severity].label}</span><span className="text-[8px] uppercase tracking-wide text-slate-600">{finding.confidence} confidence</span></span><h3 className="mt-2 text-[10px] font-semibold leading-4 text-slate-200">{finding.title}</h3><p className="mt-1 text-[9px] leading-4 text-slate-500">{finding.description}</p><code className="mt-2 block truncate text-[8px] text-amber-200/60">{finding.filePath}{finding.startLine ? `:${finding.startLine}` : ''}</code></button><div className="mt-2 border-t border-white/[0.06] pt-2"><p className="text-[9px] leading-4 text-slate-500">{finding.suggestedComment}</p><button type="button" onClick={() => void copyFinding(finding)} className="mt-1.5 inline-flex items-center gap-1 text-[8px] font-semibold text-violet-300 hover:text-violet-200"><Copy className="h-2.5 w-2.5" />{copiedFinding === finding.id ? 'Copied' : 'Copy suggested comment'}</button></div></article>)}</div>}</div>}
            {!session.automatedReview && !automating && <div className="mt-3 rounded-lg border border-dashed border-white/[0.08] px-3 py-4 text-center"><Circle className="mx-auto h-4 w-4 text-slate-700" /><p className="mt-2 text-[9px] leading-4 text-slate-600">Run a separate agent pass after the walkthrough is ready. Findings cite changed paths and remain private.</p></div>}
            {findingsForSelected.length > 0 && <p className="mt-2 text-[8px] font-semibold uppercase tracking-wide text-amber-300/60">{findingsForSelected.length} candidate {findingsForSelected.length === 1 ? 'finding' : 'findings'} in this concept</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
