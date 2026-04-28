let _pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

export async function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import('pdfjs-dist').then((m) => {
      // Configure worker lazily so pdfjs-dist stays off the critical path.
      m.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      m.GlobalWorkerOptions.workerPort = null;
      return m;
    });
  }
  return _pdfjsPromise;
}

