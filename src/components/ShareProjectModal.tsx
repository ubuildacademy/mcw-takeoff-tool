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
import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { projectService } from '../services/apiService';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRecipients(input: string): string[] {
  const parsed = input
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(parsed)]; // Deduplicate
}

function validateEmails(emails: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  emails.forEach((e) => (EMAIL_REGEX.test(e) ? valid.push(e) : invalid.push(e)));
  return { valid, invalid };
}

export interface ShareProjectModalProps {
  projectId: string;
  projectName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ShareProjectModal({
  projectId,
  projectName,
  isOpen,
  onClose,
}: ShareProjectModalProps) {
  const [recipientsInput, setRecipientsInput] = useState('');
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
      const result = await projectService.shareProject(projectId, {
        recipients: valid,
        message: message.trim() || undefined,
      });
      if (result.deliveryMethod === 'link') {
        toast.success(
          `Project shared with ${valid.length} recipient${valid.length === 1 ? '' : 's'}. They will receive an email with a link (expires in 7 days) and will need to sign in to import.`
        );
      } else {
        toast.success(
          `Project shared with ${valid.length} recipient${valid.length === 1 ? '' : 's'}. The backup is attached to the email.`
        );
      }
      setRecipientsInput('');
      setMessage('');
      onClose();
    } catch (error) {
      console.error('Share project error:', error);
      const errMsg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error instanceof Error ? error.message : 'Failed to share project. Please try again.');
      toast.error(errMsg);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Project via Email
          </DialogTitle>
          <DialogDescription>
            Send "{projectName}" to collaborators. Recipients will need to sign in or create an account to import the project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="recipients">Recipients (comma or space separated)</Label>
            <Input
              id="recipients"
              type="text"
              placeholder="colleague@company.com, estimator@example.com"
              value={recipientsInput}
              onChange={(e) => setRecipientsInput(e.target.value)}
              disabled={sending}
            />
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
            <p className="text-xs text-muted-foreground">
              Small projects are attached to the email. Larger ones are shared via a 7-day link.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? 'Sending...' : 'Share Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
