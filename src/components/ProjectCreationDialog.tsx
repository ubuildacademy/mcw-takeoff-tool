import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { 
  Building2 
} from 'lucide-react';
import { useProjectStore } from '../store/slices/projectSlice';
import type { Project } from '../types';

interface ProjectCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (project: Project) => void;
}

interface JobFormData {
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
}

const EMPTY_FORM: JobFormData = {
  name: '',
  client: '',
  location: '',
  description: '',
  projectType: '',
  startDate: '',
  estimatedValue: '',
  contactPerson: '',
  contactEmail: '',
  contactPhone: '',
};

export function ProjectCreationDialog({ open, onOpenChange, onCreated }: ProjectCreationDialogProps) {
  const addProject = useProjectStore((s) => s.addProject);
  
  const [formData, setFormData] = useState<JobFormData>({ ...EMPTY_FORM });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Radix often keeps dialog content mounted when closed; reset form when closed.
  useEffect(() => {
    if (open) return;
    setFormData({ ...EMPTY_FORM });
  }, [open]);

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

  const handleInputChange = (field: keyof JobFormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (isSubmitting) return;
    if (!isFormValid) {
      return;
    }
    
    setIsSubmitting(true);

    try {
      const now = new Date().toISOString();
      const payload: Omit<Project, 'id' | 'lastModified' | 'takeoffCount'> = {
        name: formData.name,
        client: formData.client,
        location: formData.location,
        status: 'active',
        createdAt: now,
        description: formData.description,
        projectType: formData.projectType,
        startDate: formData.startDate,
        estimatedValue: formData.estimatedValue ? parseFloat(formData.estimatedValue.replace(/[^0-9.]/g, '')) : undefined,
        contactPerson: formData.contactPerson,
        contactEmail: formData.contactEmail,
        contactPhone: formData.contactPhone
      };

      const projectId = await addProject(payload);
      
      const project: Project = {
        ...payload,
        id: projectId,
        lastModified: now,
        takeoffCount: 0
      };

      onCreated?.(project);
      onOpenChange(false);

      // Reset
      setFormData({ ...EMPTY_FORM });
    } catch (error) {
      console.error('Error creating job:', error);
      toast.error('Failed to create project. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = Boolean(formData.name?.trim()) && Boolean(formData.client?.trim()) && Boolean(formData.location?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto" aria-describedby="project-creation-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Create New Project
          </DialogTitle>
          <DialogDescription id="project-creation-description">
            Set up a new construction project with all the essential details.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Project Information */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Project Information</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Project Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Office Building Complex"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="client">Client *</Label>
                <Input
                  id="client"
                  placeholder="e.g., ABC Construction"
                  value={formData.client}
                  onChange={(e) => handleInputChange('client', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location">Location *</Label>
                <Input
                  id="location"
                  placeholder="e.g., Downtown, City"
                  value={formData.location}
                  onChange={(e) => handleInputChange('location', e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="projectType">Project Type</Label>
                <Select
                  value={formData.projectType}
                  onValueChange={(value) => handleInputChange('projectType', value)}
                >
                  <SelectTrigger id="projectType">
                    <SelectValue placeholder="Select project type" />
                  </SelectTrigger>
                  <SelectContent>
                    {projectTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Brief description of the project..."
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={3}
              />
            </div>
          </div>

          {/* Project Details */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Project Details</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => handleInputChange('startDate', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="estimatedValue">Estimated Value</Label>
                <Input
                  id="estimatedValue"
                  placeholder="e.g., $2,500,000"
                  value={formData.estimatedValue}
                  onChange={(e) => handleInputChange('estimatedValue', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Contact Information */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Contact Information</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contactPerson">Contact Person</Label>
                <Input
                  id="contactPerson"
                  placeholder="e.g., John Smith"
                  value={formData.contactPerson}
                  onChange={(e) => handleInputChange('contactPerson', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contactEmail">Email</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  placeholder="e.g., john@company.com"
                  value={formData.contactEmail}
                  onChange={(e) => handleInputChange('contactEmail', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactPhone">Phone</Label>
              <Input
                id="contactPhone"
                type="tel"
                placeholder="e.g., (555) 123-4567"
                value={formData.contactPhone}
                onChange={(e) => handleInputChange('contactPhone', e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            {!isFormValid && (
              <div className="text-sm text-red-600 mr-auto">
                Please fill in all required fields (Project Name, Client, Location)
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className={!isFormValid ? 'opacity-50 cursor-not-allowed' : ''}
            >
              {isSubmitting ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
