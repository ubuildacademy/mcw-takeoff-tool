import { toast } from 'sonner';

/** Renders a guide article element into a multi-page PDF download. */
export async function downloadGuideAsPdf(element: HTMLElement, filename: string): Promise<void> {
  const html2canvas = (await import('html2canvas')).default;
  const { jsPDF } = await import('jspdf');

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * contentWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;

  pdf.addImage(imgData, 'PNG', margin, position, contentWidth, imgHeight);
  heightLeft -= pageHeight - margin * 2;

  while (heightLeft > 0) {
    pdf.addPage();
    position = margin - (imgHeight - heightLeft);
    pdf.addImage(imgData, 'PNG', margin, position, contentWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
  }

  const safeName = filename.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-') || 'meridian-guide';
  pdf.save(`${safeName}.pdf`);
}

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

export async function exportHelpGuidePdf(elementId: string, filename: string): Promise<void> {
  const root = document.getElementById(elementId);
  if (!root) {
    toast.error('Could not export PDF.');
    return;
  }
  try {
    await downloadGuideAsPdf(root, filename);
    toast.success('Guide PDF downloaded.');
  } catch (e) {
    console.error('Guide PDF export failed:', e);
    toast.error('PDF export failed. Try Print / Save as PDF instead.');
  }
}
