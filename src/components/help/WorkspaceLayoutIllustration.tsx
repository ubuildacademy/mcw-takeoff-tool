import { cn } from '@/lib/utils';

/** Stylized workspace chrome for the help guide — matches live UI structure, not a live capture. */
export function WorkspaceLayoutIllustration({ className }: { className?: string }) {
  return (
    <figure
      className={cn(
        'my-6 overflow-hidden rounded-lg border border-border bg-background shadow-sm',
        className
      )}
      aria-label="Workspace layout diagram: Takeoff sidebar on the left, PDF viewer in the center, Documents Search and AI Chat on the right"
    >
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2 text-[10px] sm:text-[11px]">
        <span className="rounded bg-background px-2 py-1 font-medium text-foreground shadow-sm">← Projects</span>
        <span className="rounded bg-background px-2 py-1 text-muted-foreground shadow-sm">Undo</span>
        <span className="rounded bg-background px-2 py-1 text-muted-foreground shadow-sm">Redo</span>
        <span className="hidden sm:inline text-muted-foreground">·</span>
        <span className="rounded bg-background px-2 py-1 text-muted-foreground shadow-sm">Page</span>
        <span className="rounded bg-background px-2 py-1 text-muted-foreground shadow-sm">View</span>
        <span className="rounded bg-primary/10 px-2 py-1 font-medium text-primary shadow-sm">Calibrate</span>
        <span className="rounded bg-background px-2 py-1 text-muted-foreground shadow-sm">Annotate</span>
        <span className="ml-auto rounded bg-background px-2 py-1 text-muted-foreground shadow-sm">? Help</span>
        <span className="rounded bg-background px-2 py-1 text-muted-foreground shadow-sm">Tools</span>
      </div>

      <div className="flex min-h-[280px] sm:min-h-[320px]">
        {/* Left — Takeoff */}
        <div className="flex w-[26%] min-w-[88px] max-w-[140px] shrink-0 border-r border-border bg-white">
          <div className="flex flex-1 flex-col">
            <div className="flex border-b border-border text-[9px] sm:text-[10px]">
              {['Conditions', 'Reports', 'Costs'].map((tab, i) => (
                <span
                  key={tab}
                  className={cn(
                    'flex-1 px-1 py-1.5 text-center',
                    i === 0 ? 'border-b-2 border-primary font-semibold text-primary' : 'text-muted-foreground'
                  )}
                >
                  {tab}
                </span>
              ))}
            </div>
            <div className="space-y-1.5 p-2">
              {['Exterior walls', 'Roof area', 'Door count'].map((name, i) => (
                <div
                  key={name}
                  className={cn(
                    'rounded border px-1.5 py-1 text-[9px] sm:text-[10px]',
                    i === 0 ? 'border-primary/40 bg-primary/5 font-medium' : 'border-border text-muted-foreground'
                  )}
                >
                  <span
                    className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ backgroundColor: i === 0 ? '#3b82f6' : i === 1 ? '#22c55e' : '#f59e0b' }}
                    aria-hidden
                  />
                  {name}
                </div>
              ))}
            </div>
            <p className="mt-auto px-2 pb-2 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
              Takeoff
            </p>
          </div>
          <div className="flex w-3 shrink-0 items-center justify-center border-l border-border bg-muted/30 text-[8px] text-muted-foreground">
            ‹
          </div>
        </div>

        {/* Center — viewer */}
        <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
          <div className="flex items-center gap-1 border-b border-border bg-white px-2 py-1.5 text-[9px] sm:text-[10px]">
            <span className="rounded-t border border-b-0 border-border bg-slate-50 px-2 py-0.5 font-medium">
              A-101 Floor Plan
            </span>
            <span className="px-2 py-0.5 text-muted-foreground">A-102 Roof</span>
            <span className="ml-auto text-muted-foreground">+</span>
          </div>
          <div className="border-b border-amber-200/80 bg-amber-50 px-2 py-1 text-[9px] text-amber-900 sm:text-[10px]">
            Optional mode banner — e.g. Auto Count or Titleblock selection
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-hidden p-3">
            <div className="absolute inset-3 rounded border border-slate-200 bg-white shadow-inner">
              <svg viewBox="0 0 200 140" className="h-full w-full text-slate-300" aria-hidden>
                <rect x="20" y="20" width="80" height="60" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <rect x="110" y="25" width="70" height="50" fill="none" stroke="currentColor" strokeWidth="1" />
                <line x1="20" y1="95" x2="180" y2="95" stroke="currentColor" strokeWidth="1" />
                <line x1="100" y1="20" x2="100" y2="120" stroke="currentColor" strokeWidth="1" strokeDasharray="4 3" />
                <text x="100" y="75" textAnchor="middle" fill="currentColor" fontSize="10" opacity="0.6">
                  PDF viewer
                </text>
              </svg>
            </div>
          </div>
        </div>

        {/* Right — Documents / Search / AI */}
        <div className="flex w-[28%] min-w-[96px] max-w-[160px] shrink-0 border-l border-border bg-white">
          <div className="flex w-3 shrink-0 items-center justify-center border-r border-border bg-muted/30 text-[8px] text-muted-foreground">
            ›
          </div>
          <div className="flex flex-1 flex-col">
            <div className="flex border-b border-border text-[8px] sm:text-[9px]">
              {['Documents', 'Search', 'AI Chat'].map((tab, i) => (
                <span
                  key={tab}
                  className={cn(
                    'flex-1 px-0.5 py-1.5 text-center leading-tight',
                    i === 0 ? 'border-b-2 border-primary font-semibold text-primary' : 'text-muted-foreground'
                  )}
                >
                  {tab}
                </span>
              ))}
            </div>
            <div className="space-y-1 p-2 text-[9px] sm:text-[10px]">
              <p className="font-semibold text-foreground">Project Documents</p>
              <div className="rounded border border-border px-1.5 py-1 text-muted-foreground">▾ Building A.pdf</div>
              <div className="rounded border border-primary/30 bg-primary/5 px-1.5 py-1 font-medium text-foreground">
                A-101 · Page 1
              </div>
              <div className="rounded border border-border px-1.5 py-1 text-muted-foreground">A-102 · Page 2</div>
            </div>
            <p className="mt-auto px-2 pb-2 text-[8px] text-muted-foreground">Optional panel — open with ›</p>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/50 px-3 py-1.5 text-[9px] text-muted-foreground sm:text-[10px]">
        <span>A-101 · Page 1 · Sample Project</span>
        <span className="text-foreground">Exterior walls · Linear</span>
        <span>Ready</span>
      </div>

      <figcaption className="border-t border-border bg-muted/20 px-3 py-2 text-center text-xs text-muted-foreground">
        Three-column workspace: Takeoff (left), PDF viewer with sheet tabs (center), Documents / Search / AI Chat
        (right, optional).
      </figcaption>
    </figure>
  );
}
