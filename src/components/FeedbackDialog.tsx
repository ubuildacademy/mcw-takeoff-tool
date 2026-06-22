import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, Camera, CameraOff, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { cn } from '@/lib/utils';
import { getCapturedLogs, type CapturedLog } from '../lib/consoleLogs';
import { feedbackService } from '../services/apiService';
import { supabase } from '../lib/supabase';

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-captured screenshot taken before the dialog opened (optional). */
  screenshot?: Blob | null;
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export function FeedbackDialog({ open, onOpenChange, screenshot }: FeedbackDialogProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<CapturedLog[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Pre-fill name + email from Supabase session on open
  useEffect(() => {
    if (!open) return;
    setLogs(getCapturedLogs());
    setSubmitState('idle');
    setErrorMsg('');

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setEmail(user.email ?? '');
        const fullName: string =
          (user.user_metadata?.full_name as string | undefined) ?? '';
        setName(fullName);
      }
    });
  }, [open]);

  const handleClose = useCallback(() => {
    if (submitState === 'submitting') return;
    onOpenChange(false);
    // Reset form after dialog animates out
    setTimeout(() => {
      setSubject('');
      setMessage('');
      setShowLogs(false);
      setSubmitState('idle');
      setErrorMsg('');
    }, 300);
  }, [submitState, onOpenChange]);

  const handleSubmit = useCallback(async () => {
    if (!subject.trim() || !message.trim()) {
      setErrorMsg('Please fill in the subject and message.');
      return;
    }
    setSubmitState('submitting');
    setErrorMsg('');
    try {
      await feedbackService.submit({
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
        logs,
        screenshot: includeScreenshot ? (screenshot ?? null) : null,
      });
      setSubmitState('success');
    } catch {
      setSubmitState('error');
      setErrorMsg('Failed to send feedback. Please try again or email us directly.');
    }
  }, [name, email, subject, message, logs, includeScreenshot, screenshot]);

  const screenshotUrl = screenshot ? URL.createObjectURL(screenshot) : null;

  // Revoke object URL when dialog closes or screenshot changes
  useEffect(() => {
    return () => {
      if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    };
  }, [screenshotUrl]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          firstFieldRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="w-5 h-5 text-primary" />
            Submit Feedback
          </DialogTitle>
          <DialogDescription>
            Help us improve — describe what you experienced and we&apos;ll follow up.
          </DialogDescription>
        </DialogHeader>

        {submitState === 'success' ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
            <p className="font-semibold text-foreground">Feedback sent — thank you!</p>
            <p className="text-sm text-muted-foreground">We&apos;ll review it shortly.</p>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Subject */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground" htmlFor="fb-subject">
                Subject
              </label>
              <input
                ref={firstFieldRef}
                id="fb-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief description of the issue or suggestion"
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={submitState === 'submitting'}
              />
            </div>

            {/* Message */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground" htmlFor="fb-message">
                Message
              </label>
              <textarea
                id="fb-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What happened? What did you expect? Any steps to reproduce?"
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                disabled={submitState === 'submitting'}
              />
            </div>

            {/* Screenshot toggle */}
            <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
                onClick={() => setIncludeScreenshot((v) => !v)}
                disabled={submitState === 'submitting'}
              >
                {includeScreenshot && screenshot ? (
                  <Camera className="w-4 h-4 shrink-0 text-primary" />
                ) : (
                  <CameraOff className="w-4 h-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-tight">
                    {includeScreenshot && screenshot
                      ? 'Screenshot included'
                      : screenshot
                        ? 'Screenshot excluded'
                        : 'No screenshot available'}
                  </p>
                  {screenshot && (
                    <p className="text-xs text-muted-foreground">
                      {includeScreenshot
                        ? 'Captured before this dialog opened — click to remove'
                        : 'Click to include the screenshot'}
                    </p>
                  )}
                  {!screenshot && (
                    <p className="text-xs text-muted-foreground">
                      Screenshot could not be captured for this page
                    </p>
                  )}
                </div>
                {/* Checkbox visual */}
                {screenshot && (
                  <div
                    className={cn(
                      'h-4 w-4 shrink-0 rounded border flex items-center justify-center',
                      includeScreenshot
                        ? 'bg-primary border-primary'
                        : 'border-input bg-background'
                    )}
                  >
                    {includeScreenshot && (
                      <svg className="h-3 w-3 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                )}
              </button>
              {/* Screenshot preview */}
              {includeScreenshot && screenshotUrl && (
                <div className="px-3 pb-3">
                  <img
                    src={screenshotUrl}
                    alt="Screenshot preview"
                    className="rounded border border-border w-full object-cover max-h-28"
                  />
                </div>
              )}
            </div>

            {/* Console logs collapsible */}
            <div className="rounded-md border border-border overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
                onClick={() => setShowLogs((v) => !v)}
                disabled={submitState === 'submitting'}
              >
                <AlertCircle
                  className={cn(
                    'w-4 h-4 shrink-0',
                    logs.length > 0 ? 'text-orange-500' : 'text-muted-foreground'
                  )}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-tight">
                    Console errors{' '}
                    <span
                      className={cn(
                        'inline-flex items-center justify-center rounded-full text-xs font-medium px-1.5 py-0.5 ml-1',
                        logs.length > 0
                          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {logs.length}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {logs.length > 0
                      ? 'Automatically captured — always included'
                      : 'No errors captured in this session'}
                  </p>
                </div>
                {showLogs ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
              </button>
              {showLogs && (
                <div className="px-3 pb-3 max-h-36 overflow-y-auto">
                  {logs.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No errors recorded.</p>
                  ) : (
                    <div className="space-y-1 font-mono">
                      {logs.map((log, i) => (
                        <div key={i} className="text-xs leading-relaxed">
                          <span className="text-muted-foreground">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>{' '}
                          <span className="text-orange-600 dark:text-orange-400 font-semibold">
                            ERR
                          </span>{' '}
                          <span className="text-foreground break-all">{log.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Error message */}
            {submitState === 'error' && errorMsg && (
              <p className="text-sm text-destructive">{errorMsg}</p>
            )}
            {errorMsg && submitState !== 'error' && (
              <p className="text-sm text-destructive">{errorMsg}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {submitState === 'success' ? (
            <Button onClick={handleClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={submitState === 'submitting'}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitState === 'submitting'}>
                {submitState === 'submitting' ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending…
                  </>
                ) : (
                  'Send Feedback'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
