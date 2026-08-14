'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, FileCode2, ShieldAlert } from 'lucide-react';
import type { ReviewFinding } from '@desktop/contracts';
import { parseDiff } from '@/review/comments';
import type { ReviewFileChange } from '@/review/types';

type DesktopDiffFileProps = {
  file: ReviewFileChange;
  diffTruncated?: boolean;
  findings?: ReviewFinding[];
};

const kindMeta: Record<ReviewFileChange['kind'], { label: string; classes: string }> = {
  added: { label: 'Added', classes: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' },
  modified: { label: 'Modified', classes: 'border-blue-400/20 bg-blue-400/10 text-blue-300' },
  deleted: { label: 'Deleted', classes: 'border-rose-400/20 bg-rose-400/10 text-rose-300' },
  renamed: { label: 'Renamed', classes: 'border-violet-400/20 bg-violet-400/10 text-violet-300' }
};

export default function DesktopDiffFile({ file, diffTruncated = false, findings = [] }: DesktopDiffFileProps) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const parsed = useMemo(() => parseDiff(file.diff), [file.diff]);
  const lines = showAll ? parsed.allLines : parsed.lines;
  const findingLines = useMemo(() => new Map(findings.flatMap((finding) => {
    const start = finding.startLine;
    const end = finding.endLine ?? start;
    if (!start || !end || end - start > 500) return [];
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => [start + index, finding] as const);
  })), [findings]);
  const meta = kindMeta[file.kind];

  return (
    <figure id={`desktop-file-${encodeURIComponent(file.path)}`} className="overflow-hidden rounded-xl border border-slate-800 bg-[#0d1117] shadow-[0_14px_40px_rgba(15,23,42,0.12)]">
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] bg-[#11161e] px-4 py-3">
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-w-0 items-center gap-2.5 text-left">
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
          <FileCode2 className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <code className="truncate text-[11px] font-medium text-slate-200">{file.path}</code>
          <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${meta.classes}`}>{meta.label}</span>
        </button>
        <span className="flex shrink-0 items-center gap-3 text-[10px] font-semibold"><span className="text-emerald-300">+{parsed.additions}</span><span className="text-rose-300">−{parsed.deletions}</span>{findings.length > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-amber-200"><ShieldAlert className="h-3 w-3" />{findings.length}</span>}</span>
      </div>
      {open && (
        <>
          {file.oldPath && <div className="border-b border-white/[0.06] bg-violet-500/[0.06] px-4 py-2 text-[10px] text-violet-200/70">Renamed from <code>{file.oldPath}</code></div>}
          <div className="max-h-[46rem] overflow-auto py-2 font-mono text-[11px] leading-[1.55] text-slate-300" tabIndex={0} aria-label={`Diff for ${file.path}`}>
            {lines.length ? lines.map((line) => {
              const finding = line.newLine ? findingLines.get(line.newLine) : undefined;
              const tone = line.kind === 'add'
                ? 'bg-emerald-400/[0.09] text-emerald-100'
                : line.kind === 'remove'
                  ? 'bg-rose-400/[0.09] text-rose-100'
                  : line.kind === 'meta'
                    ? 'my-1 border-y border-blue-400/10 bg-blue-400/[0.07] text-blue-200'
                    : 'text-slate-400';
              return (
                <div key={line.id} className={`grid min-w-max grid-cols-[3.25rem_3.25rem_1.25rem_minmax(36rem,1fr)_1.5rem] px-3 ${tone} ${finding ? 'ring-1 ring-inset ring-amber-300/25' : ''}`} title={finding?.title}>
                  <span className="select-none pr-2 text-right text-slate-600">{line.oldLine ?? ''}</span>
                  <span className="select-none pr-2 text-right text-slate-600">{line.newLine ?? ''}</span>
                  <span className="select-none text-slate-600">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span>
                  <code className="whitespace-pre pr-4">{line.text || ' '}</code>
                  {finding ? <ShieldAlert className="my-auto h-3 w-3 text-amber-300" /> : null}
                </div>
              );
            }) : <div className="px-4 py-8 text-center font-sans text-xs text-slate-600">Git recorded this file change without a textual patch.</div>}
            {parsed.clipped && !showAll && <div className="mt-2 flex justify-center border-t border-white/[0.06] pt-3"><button type="button" onClick={() => setShowAll(true)} className="rounded-lg border border-white/10 px-3 py-1.5 font-sans text-[10px] font-semibold text-slate-400 hover:bg-white/[0.05] hover:text-white">Show all {parsed.allLines.length} lines</button></div>}
          </div>
          {diffTruncated && <figcaption className="flex items-start gap-2 border-t border-amber-400/10 bg-amber-400/[0.06] px-4 py-2 text-[10px] leading-5 text-amber-100/70"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />The on-screen patch reached ReviewFlow’s display bound. Your local agent can still inspect the checked-out file and repository.</figcaption>}
          {file.explanation && <figcaption className="border-t border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-[10px] leading-5 text-slate-500"><strong className="mr-1 text-slate-400">Why it belongs here:</strong>{file.explanation}</figcaption>}
        </>
      )}
    </figure>
  );
}
