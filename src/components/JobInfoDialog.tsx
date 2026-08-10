import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner';
import { BaseDialog } from './ui/base-dialog';
import { useProjectStore } from '../store/slices/projectSlice';
import type { Project, JobInfo } from '../types';

interface JobInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}

const EMPTY: Required<JobInfo> = {
  jobAddress: '',
  generalContractor: '',
  gcAddress: '',
  gcPhone: '',
  superintendent: '',
  superintendentCell: '',
  gcProjectManager: '',
  gcProjectManagerPhone: '',
  ownerName: '',
  ownerAddress: '',
  ownerPhone: '',
  architectName: '',
  architectAddress: '',
  architectPhone: '',
  numberOfStories: '',
  warrantyRequired: '',
  estStartDate: '',
  billingDueDate: '',
  contractAmount: '',
  contractReceived: '',
  contractReturned: '',
  executedOnFile: '',
  ntoRequired: '',
  insuranceCertificate: '',
  permitRequired: '',
  bondRequired: '',
  company: '',
  scopeOfWork: '',
};

/**
 * Paperwork fields the Work Order document needs, pulled straight from a real MCW
 * workbook's BASIC JOB INFO sheet (2026-08-10). Every field free text and optional —
 * this is one-time-per-job data entry, not something the costing engine reads.
 */
export function JobInfoDialog({ open, onOpenChange, project }: JobInfoDialogProps) {
  const updateProject = useProjectStore((s) => s.updateProject);
  const [form, setForm] = useState<Required<JobInfo>>({ ...EMPTY, ...project?.jobInfo });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const set = (field: keyof JobInfo, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    try {
      // Trim and drop empty strings so a field cleared back to blank doesn't linger as ''.
      const jobInfo: JobInfo = {};
      for (const [key, value] of Object.entries(form)) {
        const trimmed = value.trim();
        if (trimmed) jobInfo[key as keyof JobInfo] = trimmed;
      }
      await updateProject(project.id, { jobInfo });
      toast.success('Job info saved!');
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save job info:', error);
      toast.error('Failed to save job info. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Job Info"
      maxWidth="2xl"
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="job-info-form" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      }
    >
      <form id="job-info-form" onSubmit={handleSubmit} className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Paperwork fields for the Work Order document. All optional — fill in what you have.
        </p>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Job</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="jobAddress">Job Address</Label>
              <Input id="jobAddress" value={form.jobAddress} onChange={(e) => set('jobAddress', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="numberOfStories"># of Stories</Label>
              <Input id="numberOfStories" value={form.numberOfStories} onChange={(e) => set('numberOfStories', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="company">MCW Company/Division</Label>
              <Input id="company" value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="e.g. MCW Waterproofing" />
            </div>
            <div>
              <Label htmlFor="estStartDate">Est. Start Date</Label>
              <Input id="estStartDate" value={form.estStartDate} onChange={(e) => set('estStartDate', e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="scopeOfWork">Scope of Work</Label>
            <Textarea id="scopeOfWork" value={form.scopeOfWork} onChange={(e) => set('scopeOfWork', e.target.value)} rows={3} />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">General Contractor</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="generalContractor">GC Name</Label>
              <Input id="generalContractor" value={form.generalContractor} onChange={(e) => set('generalContractor', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="gcAddress">GC Address</Label>
              <Input id="gcAddress" value={form.gcAddress} onChange={(e) => set('gcAddress', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="gcPhone">GC Office Phone</Label>
              <Input id="gcPhone" value={form.gcPhone} onChange={(e) => set('gcPhone', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="superintendent">Superintendent</Label>
              <Input id="superintendent" value={form.superintendent} onChange={(e) => set('superintendent', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="superintendentCell">Superintendent Cell</Label>
              <Input id="superintendentCell" value={form.superintendentCell} onChange={(e) => set('superintendentCell', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="gcProjectManager">GC Project Manager</Label>
              <Input id="gcProjectManager" value={form.gcProjectManager} onChange={(e) => set('gcProjectManager', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="gcProjectManagerPhone">GC PM Phone</Label>
              <Input id="gcProjectManagerPhone" value={form.gcProjectManagerPhone} onChange={(e) => set('gcProjectManagerPhone', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Owner</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ownerName">Owner Name</Label>
              <Input id="ownerName" value={form.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ownerAddress">Owner Address</Label>
              <Input id="ownerAddress" value={form.ownerAddress} onChange={(e) => set('ownerAddress', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ownerPhone">Owner Phone</Label>
              <Input id="ownerPhone" value={form.ownerPhone} onChange={(e) => set('ownerPhone', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Architect</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="architectName">Architect Name</Label>
              <Input id="architectName" value={form.architectName} onChange={(e) => set('architectName', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="architectAddress">Architect Address</Label>
              <Input id="architectAddress" value={form.architectAddress} onChange={(e) => set('architectAddress', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="architectPhone">Architect Phone</Label>
              <Input id="architectPhone" value={form.architectPhone} onChange={(e) => set('architectPhone', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Compliance &amp; Contract</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="warrantyRequired">Warranty Required</Label>
              <Input id="warrantyRequired" value={form.warrantyRequired} onChange={(e) => set('warrantyRequired', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ntoRequired">NTO Required</Label>
              <Input id="ntoRequired" value={form.ntoRequired} onChange={(e) => set('ntoRequired', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="insuranceCertificate">Insurance Certificate</Label>
              <Input id="insuranceCertificate" value={form.insuranceCertificate} onChange={(e) => set('insuranceCertificate', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="permitRequired">Permit Required</Label>
              <Input id="permitRequired" value={form.permitRequired} onChange={(e) => set('permitRequired', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="bondRequired">Bond Required</Label>
              <Input id="bondRequired" value={form.bondRequired} onChange={(e) => set('bondRequired', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="billingDueDate">Billing Due Date</Label>
              <Input id="billingDueDate" value={form.billingDueDate} onChange={(e) => set('billingDueDate', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contractAmount">Original Contract Amount</Label>
              <Input id="contractAmount" value={form.contractAmount} onChange={(e) => set('contractAmount', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="executedOnFile">Executed on File</Label>
              <Input id="executedOnFile" value={form.executedOnFile} onChange={(e) => set('executedOnFile', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contractReceived">Contract Received</Label>
              <Input id="contractReceived" value={form.contractReceived} onChange={(e) => set('contractReceived', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="contractReturned">Contract Returned</Label>
              <Input id="contractReturned" value={form.contractReturned} onChange={(e) => set('contractReturned', e.target.value)} />
            </div>
          </div>
        </div>
      </form>
    </BaseDialog>
  );
}
