import { Upload } from 'lucide-react';
import { PDF_UPLOAD_ACCEPT } from '../../lib/pdfUpload';
import { Button } from '../ui/button';

const EMPTY_UPLOAD_INPUT_ID = 'pdf-upload-empty';

export interface EmptyDocumentsPlaceholderProps {
  onPdfUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  uploading: boolean;
}

export function EmptyDocumentsPlaceholder({ onPdfUpload, uploading }: EmptyDocumentsPlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 bg-muted/30 px-6 text-center">
      <p className="text-lg font-medium text-foreground mb-1">No documents uploaded yet</p>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        Upload a PDF to open plans and start takeoffs. You can add more files from the Documents panel anytime.
      </p>
      <input
        id={EMPTY_UPLOAD_INPUT_ID}
        type="file"
        accept={PDF_UPLOAD_ACCEPT}
        onChange={onPdfUpload}
        className="hidden"
        multiple
        disabled={uploading}
      />
      <label htmlFor={EMPTY_UPLOAD_INPUT_ID}>
        <Button size="lg" variant="default" asChild disabled={uploading}>
          <span className="inline-flex items-center gap-2 cursor-pointer">
            <Upload className="w-5 h-5" />
            {uploading ? 'Uploading…' : 'Browse and upload PDF'}
          </span>
        </Button>
      </label>
    </div>
  );
}
