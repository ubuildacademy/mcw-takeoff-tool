import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from './ui/dialog';
import { Mail, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { projectService } from '../services/apiService';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** When total report size exceeds this, use Supabase link delivery instead of attachments. Must match server REPORT_DELIVERY.ATTACHMENT_LIMIT_BYTES. */
const EMAIL_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;

function parseRecipients(input: string): string[] {
  return input
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function validateEmails(emails: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  emails.forEach((e) => (EMAIL_REGEX.test(e) ? valid.push(e) : invalid.push(e)));
  return { valid, invalid };
}

async function doSendReport(
  projectId: string,
  filesToSend: Array<{ file: Blob; filename: string }>,
  valid: string[],
  format: 'excel' | 'pdf' | 'both',
  message: string,
  deliveryMethod: 'attachment' | 'link'
) {
  if (format === 'both') {
    await projectService.sendReport(projectId, {
      files: [filesToSend[0], filesToSend[1]],
      recipients: valid,
      format: 'both',
      message: message || undefined,
      deliveryMethod,
    });
  } else {
    await projectService.sendReport(projectId, {
      file: filesToSend[0].file,
      filename: filesToSend[0].filename,
      recipients: valid,
      format,
      message: message || undefined,
      deliveryMethod,
    });
  }
}

export interface SendReportModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  generateExcelBuffer: () => Promise<{ buffer: ArrayBuffer; filename: string }>;
  generatePDFBuffer: () => Promise<{ buffer: Uint8Array; filename: string }>;
}

export function SendReportModal({
  projectId,
  isOpen,
  onClose,
  generateExcelBuffer,
  generatePDFBuffer,
}: SendReportModalProps) {
  const [recipientsInput, setRecipientsInput] = useState('');
  const [format, setFormat] = useState<'excel' | 'pdf' | 'both'>('excel');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [linkDeliveryConfirm, setLinkDeliveryConfirm] = useState<{
    filesToSend: Array<{ file: Blob; filename: string }>;
    valid: string[];
  } | null>(null);

  const handleSend = async () => {
    const parsed = parseRecipients(recipientsInput);
    if (parsed.length === 0) {
      toast.error('Please enter at least one email address');
      return;
    }
    if (parsed.length > 10) {
      toast.error('Maximum 10 recipients allowed');
      return;
    }
    const { valid, invalid } = validateEmails(parsed);
    if (invalid.length > 0) {
      toast.error(`Invalid email address(es): ${invalid.join(', ')}`);
      return;
    }

    setSending(true);
    try {
      let filesToSend: Array<{ file: Blob; filename: string }>;
      if (format === 'both') {
        const [excelResult, pdfResult] = await Promise.all([generateExcelBuffer(), generatePDFBuffer()]);
        const excelBlob = new Blob([excelResult.buffer as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const pdfBlob = new Blob([pdfResult.buffer as BlobPart], { type: 'application/pdf' });
        filesToSend = [
          { file: excelBlob, filename: excelResult.filename },
          { file: pdfBlob, filename: pdfResult.filename },
        ];
      } else {
        const { buffer, filename } =
          format === 'excel' ? await generateExcelBuffer() : await generatePDFBuffer();
        const blob = new Blob([buffer as BlobPart], {
          type: format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
        });
        filesToSend = [{ file: blob, filename }];
      }

      const totalSize = filesToSend.reduce((sum, { file }) => sum + file.size, 0);
      const useLinkDelivery = totalSize > EMAIL_ATTACHMENT_LIMIT_BYTES;

      if (useLinkDelivery) {
        setLinkDeliveryConfirm({ filesToSend, valid });
        setSending(false);
        return;
      }

      await doSendReport(projectId, filesToSend, valid, format, message.trim(), 'attachment');
      toast.success(`Report sent to ${valid.length} recipient${valid.length === 1 ? '' : 's'}`);
      setRecipientsInput('');
      setMessage('');
      onClose();
    } catch (error) {
      console.error('Send report error:', error);
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error instanceof Error ? error.message : 'Failed to send report. Please try again.');
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  const handleConfirmLinkDelivery = async () => {
    if (!linkDeliveryConfirm) return;
    setSending(true);
    try {
      await doSendReport(
        projectId,
        linkDeliveryConfirm.filesToSend,
        linkDeliveryConfirm.valid,
        format,
        message.trim(),
        'link'
      );
      toast.success(
        `Report shared via download links with ${linkDeliveryConfirm.valid.length} recipient${linkDeliveryConfirm.valid.length === 1 ? '' : 's'} (links expire in 7 days)`
      );
      setRecipientsInput('');
      setMessage('');
      setLinkDeliveryConfirm(null);
      onClose();
    } catch (error) {
      console.error('Send report error:', error);
      const errMsg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error instanceof Error ? error.message : 'Failed to send report. Please try again.');
      toast.error(errMsg);
    } finally {
      setSending(false);
    }
  };

  const handleBackFromLinkConfirm = () => {
    setLinkDeliveryConfirm(null);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setLinkDeliveryConfirm(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Quantity Report
          </DialogTitle>
          <DialogDescription>
            Send the quantity report to project superintendents, reviewers, or anyone who needs to see your takeoff.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="recipients">Recipients (comma or space separated)</Label>
            <Input
              id="recipients"
              type="text"
              placeholder="superintendent@company.com, reviewer@example.com"
              value={recipientsInput}
              onChange={(e) => setRecipientsInput(e.target.value)}
              disabled={sending}
            />
            <p className="text-xs text-muted-foreground">
              You can send to any email address—recipients do not need to be in the project.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Format</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  checked={format === 'excel'}
                  onChange={() => setFormat('excel')}
                  disabled={sending}
                  className="rounded-full"
                />
                <span>Excel (.xlsx)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  checked={format === 'pdf'}
                  onChange={() => setFormat('pdf')}
                  disabled={sending}
                  className="rounded-full"
                />
                <span>PDF</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  checked={format === 'both'}
                  onChange={() => setFormat('both')}
                  disabled={sending}
                  className="rounded-full"
                />
                <span>Both (Excel + PDF)</span>
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Personal message (optional)</Label>
            <Textarea
              id="message"
              placeholder="Add a note for the recipients..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              disabled={sending}
              className="resize-none"
            />
          </div>

          {linkDeliveryConfirm && (
            <div className="flex gap-3 rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-500/30 p-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">Report too large for email attachments</p>
                <p className="mt-1 text-amber-700 dark:text-amber-300">
                  Recipients will receive secure download links instead. <strong>These links expire in 7 days.</strong>
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {linkDeliveryConfirm ? (
            <>
              <Button variant="outline" onClick={handleBackFromLinkConfirm} disabled={sending}>
                Back
              </Button>
              <Button onClick={handleConfirmLinkDelivery} disabled={sending}>
                {sending ? 'Sending...' : 'Send via links'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={sending}>
                Cancel
              </Button>
              <Button onClick={handleSend} disabled={sending}>
                {sending ? 'Sending...' : 'Send Report'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
