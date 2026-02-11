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
  ChevronLeft,
  ChevronRight,
  Undo2,
  Redo2,
  Layout,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
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
  annotationTool,
  annotationColor,
  onAnnotationToolChange,
  onAnnotationColorChange,
  onClearAnnotations,
  isOrthoSnapping,
  isMeasuring,
  isCalibrating,
  measurementType: _measurementType,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: TakeoffWorkspaceHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 p-2 sm:p-4 border-b bg-muted/30 flex-wrap lg:flex-nowrap min-w-0">
      {/* Left - Back, Undo/Redo */}
      <div className="flex items-center gap-2 sm:gap-6 shrink-0">
        <Button variant="ghost" onClick={onBackToProjects} className="flex items-center gap-2" title="Back to Projects">
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span className="hidden lg:inline">Back to Projects</span>
        </Button>
        <Separator orientation="vertical" className="h-8 hidden sm:block" />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={onRedo} disabled={!canRedo} title="Redo (⌘⇧Z)">
            <Redo2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Center - Page nav, View (dropdown on small) or inline scale/rotate/calibrate (md+), Annotate */}
      <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1 justify-center flex-wrap lg:flex-nowrap">
        <div className="flex items-center gap-1 sm:gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1 || !currentPdfFile}
            title="Previous page"
          >
            <ChevronLeft className="w-4 h-4 lg:hidden" />
            <span className="hidden lg:inline">Previous</span>
          </Button>
          <span className="shrink-0 whitespace-nowrap px-2 sm:px-3 py-1 bg-gray-100 rounded text-sm">
            {currentPdfFile ? `${currentPage} / ${totalPages}` : 'No PDF'}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages || !currentPdfFile}
            title="Next page"
          >
            <ChevronRight className="w-4 h-4 lg:hidden" />
            <span className="hidden lg:inline">Next</span>
          </Button>
        </div>

        <Separator orientation="vertical" className="h-8 hidden lg:block" />

        {/* View dropdown: scale, reset, rotate, calibrate - visible below lg to avoid mid-size overflow */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="lg:hidden flex items-center gap-1" title="View options">
              <Layout className="w-4 h-4" />
              <span>{currentPdfFile ? `${Math.round(scale * 100)}%` : 'View'}</span>
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="min-w-[200px]">
            {currentPdfFile && (
              <>
                <DropdownMenuLabel className="text-xs">Zoom</DropdownMenuLabel>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => onScaleChange(Math.max(0.5, scale - 0.1))}
                    title="Zoom out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <span className="flex-1 text-center text-sm tabular-nums">{Math.round(scale * 100)}%</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => onScaleChange(Math.min(5, scale + 0.1))}
                    title="Zoom in"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onResetView}>
                  <Maximize2 className="w-4 h-4 mr-2" />
                  Reset View
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">Rotate</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onRotatePage('counterclockwise')}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Rotate counterclockwise
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRotatePage('clockwise')}>
                  <RotateCw className="w-4 h-4 mr-2" />
                  Rotate clockwise
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onClick={onCalibrateScale}
              className={isPageCalibrated ? 'text-green-700' : 'text-orange-700'}
            >
              {isPageCalibrated ? 'Recalibrate' : 'Calibrate Scale'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Inline view tools - visible from lg up (keeps mid-size bar from overflowing) */}
        {currentPdfFile && (
          <>
            <div className="hidden lg:flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => onScaleChange(Math.max(0.5, scale - 0.1))} title="Zoom out">-</Button>
              <span className="px-3 py-1 bg-gray-100 rounded text-sm min-w-[60px] text-center">{Math.round(scale * 100)}%</span>
              <Button size="sm" variant="outline" onClick={() => onScaleChange(Math.min(5, scale + 0.1))} title="Zoom in">+</Button>
              <Button size="sm" variant="outline" onClick={onResetView}>Reset View</Button>
            </div>
            <Separator orientation="vertical" className="h-8 hidden lg:block" />
            <div className="hidden lg:flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => onRotatePage('counterclockwise')} title="Rotate counterclockwise">
                <RotateCcw className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => onRotatePage('clockwise')} title="Rotate clockwise">
                <RotateCw className="w-4 h-4" />
              </Button>
            </div>
            <Separator orientation="vertical" className="h-8 hidden lg:block" />
          </>
        )}

        <div className="hidden lg:block">
          <Button
            size="sm"
            variant={isPageCalibrated ? 'default' : 'secondary'}
            onClick={onCalibrateScale}
            className={isPageCalibrated ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-orange-600 hover:bg-orange-700 text-white'}
            title={isPageCalibrated ? 'Recalibrate' : 'Calibrate Scale'}
          >
            {isPageCalibrated ? 'Recalibrate' : 'Calibrate Scale'}
          </Button>
        </div>

        <Separator orientation="vertical" className="h-8 hidden lg:block" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant={annotationTool ? 'default' : 'outline'}
              className={annotationTool ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
              title="Annotate"
            >
              <Pencil className="w-4 h-4 shrink-0 lg:mr-1" />
              <span className="hidden lg:inline">Annotate</span>
              <ChevronDown className="w-3 h-3 ml-1 shrink-0" />
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
                id="annotation-color"
                name="annotation-color"
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

      {/* Right - Ortho badge, Saved status */}
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {((isOrthoSnapping && isMeasuring) || (isCalibrating && isOrthoSnapping)) && (
          <div className="flex items-center gap-1 bg-green-600 text-white px-2 py-1 rounded text-xs">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h18"/>
              <path d="M12 3v18"/>
            </svg>
            <span>Ortho</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-gray-600" title="All changes saved">
          <div className="w-2 h-2 bg-green-500 rounded-full shrink-0" />
          <span className="hidden xl:inline">All changes saved</span>
        </div>
      </div>
    </div>
  );
}
