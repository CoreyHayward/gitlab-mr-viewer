'use client';

import { type FormEvent, useEffect, useState } from 'react';
import {
  Bot,
  Check,
  CircleDot,
  Code2,
  Command,
  GitBranch,
  Loader2,
  RefreshCw,
  Server,
  Sparkles,
  X
} from 'lucide-react';
import type {
  AgentKind,
  DashboardView,
  DesktopBootstrap,
  DesktopSettings,
  SourceControlKind,
  UpdateSettingsRequest
} from '@desktop/contracts';

type DesktopSettingsDialogProps = {
  open: boolean;
  bootstrap: DesktopBootstrap;
  settings: DesktopSettings;
  onClose: () => void;
  onSave: (request: UpdateSettingsRequest) => Promise<void>;
  onRescan: () => Promise<void>;
};

const viewOptions: Array<{ value: DashboardView; label: string }> = [
  { value: 'review-requested', label: 'Review requests' },
  { value: 'assigned', label: 'Assigned to me' },
  { value: 'authored', label: 'Authored by me' },
  { value: 'all-open', label: 'All open merge requests' }
];

const commandFor = (kind: AgentKind) => kind === 'codex' ? 'codex login' : 'claude auth login';

export default function DesktopSettingsDialog({ open, bootstrap, settings, onClose, onSave, onRescan }: DesktopSettingsDialogProps) {
  const [sourceControl, setSourceControl] = useState<SourceControlKind>(settings.sourceControl);
  const [host, setHost] = useState(settings.hosts[settings.sourceControl]);
  const [defaultView, setDefaultView] = useState(settings.defaultView);
  const [agentKind, setAgentKind] = useState<AgentKind>(settings.agent.kind);
  const [model, setModel] = useState(settings.agent.model ?? '');
  const [saving, setSaving] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSourceControl(settings.sourceControl);
    setHost(settings.hosts[settings.sourceControl]);
    setDefaultView(settings.defaultView);
    setAgentKind(settings.agent.kind);
    setModel(settings.agent.model ?? '');
    setError(null);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, open, saving]);

  if (!open) return null;

  const handleSourceControl = (kind: SourceControlKind) => {
    setSourceControl(kind);
    setHost(settings.hosts[kind]);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        sourceControl,
        hosts: { [sourceControl]: host },
        defaultView,
        agent: { kind: agentKind, ...(model.trim() ? { model: model.trim() } : {}) }
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const rescan = async () => {
    setRescanning(true);
    setError(null);
    try {
      await onRescan();
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Connections could not be rescanned.');
    } finally {
      setRescanning(false);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(null), 1_500);
    } catch {
      setError(`Run this command in Terminal: ${value}`);
    }
  };

  return (
    <div className="desktop-no-drag fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 p-6 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onClose(); }}>
      <form onSubmit={handleSubmit} className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#11141b] text-slate-100 shadow-[0_30px_100px_rgba(0,0,0,0.55)]" role="dialog" aria-modal="true" aria-labelledby="desktop-settings-title">
        <header className="flex items-start justify-between border-b border-white/[0.08] px-6 py-5">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-indigo-300">Local connections</p><h2 id="desktop-settings-title" className="mt-1 text-xl font-semibold tracking-[-0.02em] text-white">ReviewFlow settings</h2><p className="mt-1 text-xs text-slate-500">ReviewFlow delegates authentication to tools already trusted on this Mac.</p></div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-white/[0.06] hover:text-white" aria-label="Close settings"><X className="h-4 w-4" /></button>
        </header>

        <div className="max-h-[calc(88vh-9rem)] overflow-y-auto px-6 py-5">
          <section>
            <div className="flex items-center justify-between"><div><h3 className="text-xs font-semibold text-slate-200">Source control</h3><p className="mt-1 text-[11px] text-slate-500">Adapters normalize hosted reviews before the dashboard or agent sees them.</p></div><button type="button" onClick={() => void rescan()} disabled={rescanning} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-slate-400 hover:bg-white/[0.05] hover:text-white disabled:opacity-60">{rescanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Rescan tools</button></div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {bootstrap.sourceControls.map((connection) => {
                const active = sourceControl === connection.kind;
                const disabled = !connection.implemented;
                return (
                  <button key={connection.kind} type="button" disabled={disabled} onClick={() => handleSourceControl(connection.kind)} className={`relative rounded-xl border p-4 text-left transition-colors ${active ? 'border-indigo-400/60 bg-indigo-500/10' : 'border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.045]'} disabled:cursor-not-allowed disabled:opacity-55`}>
                    <span className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-semibold text-slate-100">{connection.kind === 'github' ? <Code2 className="h-4 w-4" /> : <GitBranch className="h-4 w-4 text-orange-300" />}{connection.label}</span>{disabled ? <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">Adapter ready next</span> : active ? <Check className="h-4 w-4 text-indigo-300" /> : null}</span>
                    <span className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${connection.executable.installed ? 'bg-emerald-400' : 'bg-amber-400'}`} />{connection.implemented ? connection.executable.version ?? connection.executable.error ?? 'CLI status unavailable' : 'Provider-neutral contract reserved; implementation not shipped'}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-[1fr_220px] gap-3">
              <label className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">Hostname<input value={host} onChange={(event) => setHost(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#0b0d12] px-3 text-xs font-normal tracking-normal text-slate-200 outline-none focus:border-indigo-400" placeholder="gitlab.com" /></label>
              <label className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">Default queue<select value={defaultView} onChange={(event) => setDefaultView(event.target.value as DashboardView)} className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#0b0d12] px-3 text-xs font-normal tracking-normal text-slate-200 outline-none focus:border-indigo-400">{viewOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            </div>
            <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] leading-5 text-slate-500"><Server className="mr-1.5 inline h-3 w-3" />Credentials stay inside the provider CLI. ReviewFlow never asks for, stores, or sends a GitLab token through the renderer.</div>
          </section>

          <section className="mt-7 border-t border-white/[0.07] pt-6">
            <div><h3 className="text-xs font-semibold text-slate-200">Agent harness</h3><p className="mt-1 text-[11px] text-slate-500">Choose which local subscription constructs walkthroughs and investigates review questions.</p></div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {bootstrap.harnesses.map((harness) => {
                const active = agentKind === harness.kind;
                return (
                  <button key={harness.kind} type="button" onClick={() => setAgentKind(harness.kind)} className={`rounded-xl border p-4 text-left transition-colors ${active ? 'border-violet-400/55 bg-violet-500/10' : 'border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.045]'}`}>
                    <span className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-semibold"><Bot className={`h-4 w-4 ${harness.kind === 'codex' ? 'text-emerald-300' : 'text-orange-300'}`} />{harness.label}</span>{active && <Check className="h-4 w-4 text-violet-300" />}</span>
                    <span className={`mt-2 flex items-center gap-1.5 text-[10px] ${harness.authenticated ? 'text-emerald-300' : 'text-amber-300'}`}><CircleDot className="h-3 w-3" />{harness.authenticated ? 'Authenticated and ready' : harness.installed ? 'Installed, sign-in required' : 'CLI not installed'}</span>
                    <span className="mt-1 block truncate text-[9px] text-slate-600">{harness.version ?? harness.path ?? harness.error}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
              <label className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">Model override <span className="normal-case tracking-normal text-slate-600">(optional)</span><input value={model} onChange={(event) => setModel(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#0b0d12] px-3 text-xs font-normal tracking-normal text-slate-200 outline-none placeholder:text-slate-700 focus:border-violet-400" placeholder="Use the harness default" /></label>
              {!bootstrap.harnesses.find((harness) => harness.kind === agentKind)?.authenticated && <button type="button" onClick={() => void copy(commandFor(agentKind))} className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[10px] font-semibold text-slate-300 hover:bg-white/[0.07]"><Command className="h-3.5 w-3.5" />{copied === commandFor(agentKind) ? 'Copied' : `Copy ${commandFor(agentKind)}`}</button>}
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-400/10 bg-violet-500/[0.05] px-3 py-2 text-[10px] leading-5 text-violet-200/70"><Sparkles className="mt-0.5 h-3 w-3 shrink-0" />Agent invocations are constrained to read-only repository tools. ReviewFlow builds every task itself; the renderer cannot send an arbitrary shell command or working directory.</div>
          </section>

          {error && <p className="mt-5 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-200" role="alert">{error}</p>}
        </div>

        <footer className="flex items-center justify-between border-t border-white/[0.08] bg-[#0e1117] px-6 py-4">
          <span className="text-[10px] text-slate-600">ReviewFlow {bootstrap.appVersion} · unsigned local build</span>
          <span className="flex items-center gap-2"><button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-white/[0.05] hover:text-white">Cancel</button><button type="submit" disabled={saving || sourceControl === 'github'} className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-950/30 hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Save settings</button></span>
        </footer>
      </form>
    </div>
  );
}
