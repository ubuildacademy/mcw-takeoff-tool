import { Printer } from 'lucide-react';
import { Button } from '../ui/button';
import { printHelpGuide } from './helpGuidePdf';
import './helpPrint.css';

const PRINT_ROOT_ID = 'help-guide-print-root';

type HelpGuideActionsProps = {
  filename?: string;
};

export function HelpGuideActions(_props: HelpGuideActionsProps) {
  return (
    <div className="help-no-print flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => printHelpGuide(PRINT_ROOT_ID)}
        aria-label="Print or save guide as PDF"
        title="Opens your browser print dialog — choose Save as PDF to download"
      >
        <Printer className="w-4 h-4 mr-1.5" />
        Print / Save as PDF
      </Button>
    </div>
  );
}

export { PRINT_ROOT_ID };
