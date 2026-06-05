import { useState } from 'react';
import { Printer, FileDown, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { exportHelpGuidePdf, printHelpGuide } from './helpGuidePdf';
import './helpPrint.css';

const PRINT_ROOT_ID = 'help-guide-print-root';

type HelpGuideActionsProps = {
  filename: string;
};

export function HelpGuideActions({ filename }: HelpGuideActionsProps) {
  const [exporting, setExporting] = useState(false);

  return (
    <div className="help-no-print flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => printHelpGuide(PRINT_ROOT_ID)}
        aria-label="Print or save guide as PDF"
        title="Opens the print dialog — choose Save as PDF on your system"
      >
        <Printer className="w-4 h-4 mr-1.5" />
        Print / Save as PDF
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={exporting}
        onClick={async () => {
          setExporting(true);
          try {
            await exportHelpGuidePdf(PRINT_ROOT_ID, filename);
          } finally {
            setExporting(false);
          }
        }}
        aria-label="Download guide as PDF"
        title="Download a PDF copy of this page"
      >
        {exporting ? (
          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
        ) : (
          <FileDown className="w-4 h-4 mr-1.5" />
        )}
        Download PDF
      </Button>
    </div>
  );
}

export { PRINT_ROOT_ID };
