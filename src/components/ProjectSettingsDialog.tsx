import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { BaseDialog } from './ui/base-dialog';
import { useProjectStore } from '../store/slices/projectSlice';

interface ProjectSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: any; // The project to edit
  onUpdated?: () => void;
}

interface ProjectFormData {
  name: string;
  client: string;
  location: string;
  description: string;
  projectType: string;
  startDate: string;
  estimatedValue: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  status: string;
  profitMarginPercent: string;
}

export function ProjectSettingsDialog({ open, onOpenChange, project, onUpdated }: ProjectSettingsDialogProps) {
  const updateProject = useProjectStore((s) => s.updateProject);
  
  const [formData, setFormData] = useState<ProjectFormData>({
    name: project?.name || '',
    client: project?.client || '',
    location: project?.location || '',
    description: project?.description || '',
    projectType: project?.projectType || '',
    startDate: project?.startDate || '',
    estimatedValue: project?.estimatedValue?.toString() || '',
    contactPerson: project?.contactPerson || '',
    contactEmail: project?.contactEmail || '',
    contactPhone: project?.contactPhone || '',
    status: project?.status || 'active',
    profitMarginPercent: project?.profitMarginPercent?.toString() || '15'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const projectTypes = [
    'Commercial',
    'Residential',
    'Industrial',
    'Infrastructure',
    'Healthcare',
    'Education',
    'Retail',
    'Hospitality',
    'Mixed Use',
    'Other'
  ];

  const statusOptions = [
    'active',
    'on-hold',
    'completed',
    'cancelled'
  ];

  const handleInputChange = (field: keyof ProjectFormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (!formData.name.trim() || !formData.client.trim() || !formData.location.trim()) {
      alert('Please fill in all required fields (Name, Client, Location)');
      return;
    }

    setIsSubmitting(true);
    
    try {
      const projectData = {
        name: formData.name.trim(),
        client: formData.client.trim(),
        location: formData.location.trim(),
        description: formData.description.trim(),
        projectType: formData.projectType || 'Commercial',
        startDate: formData.startDate,
        estimatedValue: formData.estimatedValue ? parseFloat(formData.estimatedValue) : undefined,
        contactPerson: formData.contactPerson.trim(),
        contactEmail: formData.contactEmail.trim(),
        contactPhone: formData.contactPhone.trim(),
        status: formData.status,
        profitMarginPercent: formData.profitMarginPercent ? parseFloat(formData.profitMarginPercent) : 15
      };

      await updateProject(project.id, projectData);
      
      onUpdated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update project:', error);
      alert('Failed to update project. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <BaseDialog 
      open={open} 
      onOpenChange={onOpenChange}
      title="Project Settings"
      maxWidth="2xl"
      footer={
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="project-settings-form"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Updating...' : 'Update Project'}
          </Button>
        </div>
      }
    >
      <form id="project-settings-form" onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Basic Information</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Project Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="Enter project name"
                required
              />
            </div>

            <div>
              <Label htmlFor="client">Client *</Label>
              <Input
                id="client"
                value={formData.client}
                onChange={(e) => handleInputChange('client', e.target.value)}
                placeholder="Enter client name"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="location">Location *</Label>
              <Input
                id="location"
                value={formData.location}
                onChange={(e) => handleInputChange('location', e.target.value)}
                placeholder="Enter project location"
                required
              />
            </div>

            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={formData.status} onValueChange={(value) => handleInputChange('status', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map(status => (
                    <SelectItem key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="Enter project description"
              rows={3}
            />
          </div>
        </div>

        {/* Project Details */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Project Details</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="projectType">Project Type</Label>
              <Select value={formData.projectType} onValueChange={(value) => handleInputChange('projectType', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project type" />
                </SelectTrigger>
                <SelectContent>
                  {projectTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={formData.startDate}
                onChange={(e) => handleInputChange('startDate', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="estimatedValue">Estimated Value</Label>
              <Input
                id="estimatedValue"
                type="number"
                step="0.01"
                min="0"
                value={formData.estimatedValue}
                onChange={(e) => handleInputChange('estimatedValue', e.target.value)}
                placeholder="Enter estimated project value"
              />
            </div>

            <div>
              <Label htmlFor="profitMarginPercent">Profit Margin (%)</Label>
              <Input
                id="profitMarginPercent"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={formData.profitMarginPercent}
                onChange={(e) => handleInputChange('profitMarginPercent', e.target.value)}
                placeholder="15.0"
              />
              <p className="text-xs text-gray-500 mt-1">
                Default profit margin applied to all cost calculations
              </p>
            </div>
          </div>
        </div>

        {/* Contact Information */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Contact Information</h3>
          
          <div>
            <Label htmlFor="contactPerson">Contact Person</Label>
            <Input
              id="contactPerson"
              value={formData.contactPerson}
              onChange={(e) => handleInputChange('contactPerson', e.target.value)}
              placeholder="Enter contact person name"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contactEmail">Contact Email</Label>
              <Input
                id="contactEmail"
                type="email"
                value={formData.contactEmail}
                onChange={(e) => handleInputChange('contactEmail', e.target.value)}
                placeholder="Enter contact email"
              />
            </div>

            <div>
              <Label htmlFor="contactPhone">Contact Phone</Label>
              <Input
                id="contactPhone"
                type="tel"
                value={formData.contactPhone}
                onChange={(e) => handleInputChange('contactPhone', e.target.value)}
                placeholder="Enter contact phone"
              />
            </div>
          </div>
        </div>
      </form>
    </BaseDialog>
  );
}
