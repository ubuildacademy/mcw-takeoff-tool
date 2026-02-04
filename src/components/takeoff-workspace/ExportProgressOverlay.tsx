import React from 'react';

export interface ExportProgressOverlayProps {
  /** When type is null, overlay is not rendered */
  exportStatus: {
    type: 'excel' | 'pdf' | null;
    progress: number;
  };
}

/**
 * Full-screen overlay shown during export (Excel or PDF).
 * Renders nothing when exportStatus.type is null.
 */
export function ExportProgressOverlay({ exportStatus }: ExportProgressOverlayProps): React.ReactNode {
  if (!exportStatus.type) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="presentation">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="dialog-export-progress-title" aria-busy="true">
        <div className="flex items-center gap-4 mb-4">
          <div className="animate-spin w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full" aria-hidden="true" />
          <div>
            <h3 id="dialog-export-progress-title" className="text-lg font-semibold text-gray-900">
              Exporting {exportStatus.type.toUpperCase()} Report
            </h3>
            <p className="text-sm text-gray-600">
              Please wait while we process your data...
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Progress</span>
            <span>{exportStatus.progress}%</span>
          </div>
          <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-500 ease-out rounded-full"
              style={{ width: `${exportStatus.progress}%` }}
            />
          </div>
        </div>

        {exportStatus.type === 'pdf' && exportStatus.progress > 20 && (
          <div className="mt-4 text-xs text-gray-500">
            <p>📄 Capturing PDF pages with measurements...</p>
            <p>This may take a moment for large projects.</p>
          </div>
        )}
      </div>
    </div>
  );
}
