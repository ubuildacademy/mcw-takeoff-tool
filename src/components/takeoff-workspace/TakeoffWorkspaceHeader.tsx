import React from 'react';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  ArrowLeft,
  Pencil,
  Type,
  Square,
  Circle,
  ArrowRight,
  Palette,
  Trash2,
  ChevronDown,
  Scan,
} from 'lucide-react';
import type { TakeoffWorkspaceHeaderProps } from './TakeoffWorkspaceHeader.types';

export function TakeoffWorkspaceHeader({
  onBackToProjects,
  currentPage,
  totalPages,
  currentPdfFile,
  onPageChange,
  scale,
  onScaleChange,
  onResetView,
  onRotatePage,
  isPageCalibrated,
  onCalibrateScale,
  onOpenCVTakeoffAgent,
  annotationTool,
  annotationColor,
  onAnnotationToolChange,
  onAnnotationColorChange,
  onClearAnnotations,
  isOrthoSnapping,
  isMeasuring,
  isCalibrating,
  measurementType,
}: TakeoffWorkspaceHeaderProps) {
  return (
    <div className="flex items-center justify-between p-4 border-b bg-muted/30">
      {/* Left side - Navigation and Project Info */}
      <div className="flex items-center gap-6">
        <Button variant="ghost" onClick={onBackToProjects} className="flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </Button>
        <Separator orientation="vertical" className="h-8" />
      </div>

      {/* Center - PDF Controls */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1 || !currentPdfFile}
          >
            Previous
          </Button>
          <span className="px-3 py-1 bg-gray-100 rounded text-sm">
            {currentPdfFile ? `${currentPage} / ${totalPages}` : 'No PDF'}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages || !currentPdfFile}
          >
            Next
          </Button>
        </div>

        <Separator orientation="vertical" className="h-8" />

        {currentPdfFile && (
          <>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onScaleChange(Math.max(0.5, scale - 0.1))}
              >
                -
              </Button>
              <span className="px-3 py-1 bg-gray-100 rounded text-sm min-w-[60px] text-center">
                {Math.round(scale * 100)}%
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onScaleChange(Math.min(5, scale + 0.1))}
              >
                +
              </Button>
              <Button size="sm" variant="outline" onClick={onResetView}>
                Reset View
              </Button>
            </div>

            <Separator orientation="vertical" className="h-8" />

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRotatePage('counterclockwise')}
                title="Rotate counterclockwise"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRotatePage('clockwise')}
                title="Rotate clockwise"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                </svg>
              </Button>
            </div>

            <Separator orientation="vertical" className="h-8" />
          </>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={isPageCalibrated ? 'default' : 'secondary'}
            onClick={onCalibrateScale}
            className={isPageCalibrated ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-orange-600 hover:bg-orange-700 text-white'}
          >
            {isPageCalibrated ? 'Recalibrate' : 'Calibrate Scale'}
          </Button>
        </div>

        <Separator orientation="vertical" className="h-8" />

        <Button
          size="sm"
          variant="outline"
          className="flex items-center gap-2"
          onClick={onOpenCVTakeoffAgent}
        >
          <Scan className="w-4 h-4" />
          CV Takeoff
        </Button>

        <Separator orientation="vertical" className="h-8" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant={annotationTool ? 'default' : 'outline'}
              className={annotationTool ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
            >
              <Pencil className="w-4 h-4 mr-1" />
              Annotations
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Annotation Tools</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onAnnotationToolChange(annotationTool === 'text' ? null : 'text')}
              className={annotationTool === 'text' ? 'bg-accent' : ''}
            >
              <Type className="w-4 h-4 mr-2" />
              Text Annotation
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Shapes</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => onAnnotationToolChange(annotationTool === 'arrow' ? null : 'arrow')}
              className={annotationTool === 'arrow' ? 'bg-accent' : ''}
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              Arrow
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onAnnotationToolChange(annotationTool === 'rectangle' ? null : 'rectangle')}
              className={annotationTool === 'rectangle' ? 'bg-accent' : ''}
            >
              <Square className="w-4 h-4 mr-2" />
              Rectangle
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onAnnotationToolChange(annotationTool === 'circle' ? null : 'circle')}
              className={annotationTool === 'circle' ? 'bg-accent' : ''}
            >
              <Circle className="w-4 h-4 mr-2" />
              Circle
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="flex items-center justify-between">
              <div className="flex items-center">
                <Palette className="w-4 h-4 mr-2" />
                Color
              </div>
              <input
                type="color"
                value={annotationColor}
                onChange={(e) => onAnnotationColorChange(e.target.value)}
                className="w-8 h-6 rounded cursor-pointer"
                onClick={(e) => e.stopPropagation()}
              />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClearAnnotations} className="text-red-600 focus:text-red-600">
              <Trash2 className="w-4 h-4 mr-2" />
              Clear Annotations
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {((isOrthoSnapping && isMeasuring) || (isCalibrating && isOrthoSnapping)) && (
        <div className="flex items-center gap-1 bg-green-600 text-white px-2 py-1 rounded text-xs">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h18"/>
            <path d="M12 3v18"/>
          </svg>
          <span>Ortho</span>
        </div>
      )}

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <span>All changes saved</span>
        </div>
      </div>
    </div>
  );
}
