import { toast } from 'sonner';

export function printHelpGuide(elementId: string): void {
  const root = document.getElementById(elementId);
  if (!root) {
    toast.error('Could not open print view.');
    return;
  }
  document.body.classList.add('help-guide-printing');
  const cleanup = () => {
    document.body.classList.remove('help-guide-printing');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
