import React from 'react';
import { FileText } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import type { TakeoffWorkspaceStatusBarProps, OcrJobEntry } from './TakeoffWorkspaceHeader.types';

export function TakeoffWorkspaceStatusBar({
  selectedSheet,
  currentProject,
  selectedCondition,
  exportStatus,
  titleblockExtractionStatus,
  ocrJobs,
  uploading,
  isMeasuring,
  isCalibrating,
  measurementType,
}: TakeoffWorkspaceStatusBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30 text-sm">
      <div className="flex items-center gap-4">
        {selectedSheet && (
          <>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              <span>{selectedSheet.name}</span>
              <Badge variant="outline" className="text-xs">
                Page {selectedSheet.pageNumber}
              </Badge>
            </div>
            <Separator orientation="vertical" className="h-4" />
          </>
        )}
        <span>Project: {currentProject.name}</span>
      </div>

      <div className="flex-1 flex justify-center">
        {selectedCondition ? (
          <div className="text-center text-sm text-gray-600">
            {selectedCondition.name} - {selectedCondition.type} takeoff
          </div>
        ) : (
          <div className="text-center text-sm text-gray-600">
            Select a condition to start drawing
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        {exportStatus.type ? (
          <div className="flex items-center gap-3 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200">
            <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-blue-700">
                Exporting {exportStatus.type.toUpperCase()} report...
              </span>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-32 h-2 bg-blue-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300 ease-out rounded-full"
                    style={{ width: `${exportStatus.progress}%` }}
                  ></div>
                </div>
                <span className="text-xs text-blue-600 font-medium">{exportStatus.progress}%</span>
              </div>
            </div>
          </div>
        ) : titleblockExtractionStatus?.status === 'processing' ? (
          <div className="flex items-center gap-3 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200">
            <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-blue-700">
                Extracting Titleblocks
                {titleblockExtractionStatus.currentDocument && `: ${titleblockExtractionStatus.currentDocument}`}
                {titleblockExtractionStatus.processedPages !== undefined && titleblockExtractionStatus.totalPages !== undefined
                  ? ` (${titleblockExtractionStatus.processedPages}/${titleblockExtractionStatus.totalPages} pages)`
                  : titleblockExtractionStatus.totalPages !== undefined
                    ? ` (0/${titleblockExtractionStatus.totalPages} pages)`
                    : ''}
              </span>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-32 h-2 bg-blue-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300 ease-out rounded-full"
                    style={{ width: `${titleblockExtractionStatus.progress || 0}%` }}
                  ></div>
                </div>
                <span className="text-xs text-blue-600 font-medium">
                  {titleblockExtractionStatus.progress || 0}%
                </span>
              </div>
            </div>
          </div>
        ) : titleblockExtractionStatus?.status === 'completed' ? (
          <div className="flex items-center gap-3 bg-green-50 px-3 py-2 rounded-lg border border-green-200">
            <div className="w-5 h-5 border-2 border-green-500 rounded-full flex items-center justify-center">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-green-700">
                Titleblock Extraction Complete
                {titleblockExtractionStatus.processedPages !== undefined && titleblockExtractionStatus.totalPages !== undefined
                  ? ` (${titleblockExtractionStatus.processedPages}/${titleblockExtractionStatus.totalPages} pages)`
                  : ''}
              </span>
            </div>
          </div>
        ) : titleblockExtractionStatus?.status === 'failed' ? (
          <div className="flex items-center gap-3 bg-red-50 px-3 py-2 rounded-lg border border-red-200">
            <div className="w-5 h-5 border-2 border-red-500 rounded-full flex items-center justify-center">
              <span className="text-red-500 text-xs font-bold">×</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-red-700">Titleblock Extraction Failed</span>
              {titleblockExtractionStatus.error && (
                <span className="text-xs text-red-600 mt-1">{titleblockExtractionStatus.error}</span>
              )}
            </div>
          </div>
        ) : ocrJobs.size > 0 ? (
          <div className="flex items-center gap-3 bg-purple-50 px-3 py-2 rounded-lg border border-purple-200">
            <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full"></div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-purple-700">
                {ocrJobs.size === 1
                  ? `OCR Processing: ${Array.from(ocrJobs.values())[0].documentName}`
                  : `OCR Processing ${ocrJobs.size} documents...`}
              </span>
              {ocrJobs.size === 1 && (() => {
                const job: OcrJobEntry = Array.from(ocrJobs.values())[0];
                return (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-32 h-2 bg-purple-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 transition-all duration-300 ease-out rounded-full"
                        style={{ width: `${job.progress}%` }}
                      ></div>
                    </div>
                    <span className="text-xs text-purple-600 font-medium">
                      {job.progress}%
                      {job.processedPages && job.totalPages ? ` (${job.processedPages}/${job.totalPages})` : ''}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          <span className="text-sm text-gray-600">
            {uploading
              ? 'Uploading…'
              : isMeasuring || isCalibrating ? (
                  <span className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm">
                    {isCalibrating
                      ? 'Calibrating: Click two points to set scale'
                      : `Measuring: ${measurementType} - Click to add points`}
                  </span>
                ) : (
                  'Ready'
                )}
          </span>
        )}
      </div>
    </div>
  );
}
