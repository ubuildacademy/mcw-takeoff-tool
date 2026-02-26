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
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { projectService } from '../services/apiService';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [format, setFormat] = useState<'excel' | 'pdf'>('excel');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

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
      const { buffer, filename } =
        format === 'excel' ? await generateExcelBuffer() : await generatePDFBuffer();
      const blob = new Blob([buffer as BlobPart], {
        type: format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
      });
      await projectService.sendReport(projectId, {
        file: blob,
        filename,
        recipients: valid,
        format,
        message: message.trim() || undefined,
      });
      toast.success(`Report sent to ${valid.length} recipient${valid.length === 1 ? '' : 's'}`);
      setRecipientsInput('');
      setMessage('');
      onClose();
    } catch (error) {
      console.error('Send report error:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to send report. Please try again.'
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? 'Sending...' : 'Send Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
