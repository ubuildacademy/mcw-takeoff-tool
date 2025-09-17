import React, { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { FileUpload } from './ui/file-upload';
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
import { projectService, fileService } from '../services/apiService';
import { useTakeoffStore } from '../store/useTakeoffStore';

interface ProjectCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (project: any) => void;
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

export function ProjectCreationDialog({ open, onOpenChange, onCreated }: ProjectCreationDialogProps) {
  const { addProject } = useTakeoffStore();
  
  const [formData, setFormData] = useState<JobFormData>({
    name: '',
    client: '',
    location: '',
    description: '',
    projectType: '',
    startDate: '',
    estimatedValue: '',
    contactPerson: '',
    contactEmail: '',
    contactPhone: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

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

  const handleFileUpload = (file: File) => {
    setUploadedFiles(prev => [...prev, file]);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    console.log('Submit button clicked!');
    console.log('Form data:', formData);
    console.log('Is form valid?', isFormValid);
    console.log('Is submitting?', isSubmitting);
    
    if (isSubmitting) return;
    if (!isFormValid) {
      console.log('Form is not valid, cannot submit');
      return;
    }
    
    setIsSubmitting(true);

    try {
      const payload: any = {
        name: formData.name,
        client: formData.client,
        location: formData.location,
        status: 'active',
        description: formData.description,
        projectType: formData.projectType,
        startDate: formData.startDate,
        estimatedValue: formData.estimatedValue ? parseFloat(formData.estimatedValue.replace(/[^0-9.]/g, '')) : undefined,
        contactPerson: formData.contactPerson,
        contactEmail: formData.contactEmail,
        contactPhone: formData.contactPhone
      };

      console.log('🔥 Creating project with payload:', payload);
      const projectId = await addProject(payload);
      console.log('🔥 Project created successfully with ID:', projectId);
      
      // Get the created project from the store
      const project = { id: projectId, ...payload };

      // Upload files sequentially to show progress in network panel
      for (const f of uploadedFiles) {
        await fileService.uploadPDF(f, project.id);
      }

      onCreated?.(project);
      onOpenChange(false);

      // Reset
      setUploadedFiles([]);
      setFormData({
        name: '', client: '', location: '', description: '', projectType: '', startDate: '',
        estimatedValue: '', contactPerson: '', contactEmail: '', contactPhone: ''
      });
    } catch (error) {
      console.error('🔥 Error creating job:', error);
      console.error('🔥 Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        error
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = Boolean(formData.name?.trim()) && Boolean(formData.client?.trim()) && Boolean(formData.location?.trim());
  
  // Debug form validation
  console.log('Form validation:', {
    name: formData.name,
    client: formData.client,
    location: formData.location,
    nameValid: Boolean(formData.name?.trim()),
    clientValid: Boolean(formData.client?.trim()),
    locationValid: Boolean(formData.location?.trim()),
    isValid: isFormValid
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Create New Project
          </DialogTitle>
          <DialogDescription>
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
                  <SelectTrigger>
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

          {/* File Upload */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Project Files</h3>
            
            <FileUpload
              onFileSelect={handleFileUpload}
              acceptedTypes={['.pdf', '.dwg', '.jpg', '.jpeg', '.png']}
              maxSize={50}
              multiple={true}
            />
          </div>
        </form>

        <DialogFooter>
          {!isFormValid && (
            <div className="text-sm text-red-600 mr-auto">
              Please fill in all required fields (Project Name, Client, Location)
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleSubmit()}
            disabled={!isFormValid || isSubmitting}
            className={!isFormValid ? 'opacity-50 cursor-not-allowed' : ''}
          >
            {isSubmitting ? 'Creating...' : 'Create Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
