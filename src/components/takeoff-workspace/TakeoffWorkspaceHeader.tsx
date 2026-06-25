import React, { useMemo, useState } from 'react';
import { Button } from '../ui/button';
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
  Wrench,
  Highlighter,
  PaintBucket,
} from 'lucide-react';
import type { TakeoffWorkspaceHeaderProps } from './TakeoffWorkspaceHeader.types';
import { ToolsDialog } from '../ToolsDialog';
import { HelpMenu } from '../help/HelpMenu';
import { PDF_VIEWER_MIN_SCALE, PDF_VIEWER_MAX_SCALE } from '../pdf-viewer/usePDFViewerInteractions';
import { cn } from '../../lib/utils';

const ZOOM_STEP = 0.1;

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
  annotationFilled,
  onAnnotationToolChange,
  onAnnotationColorChange,
  onAnnotationFilledChange,
  onClearAnnotations,
  isOrthoSnapping,
  isMeasuring,
  isCalibrating,
  hasSelectedCondition = false,
  measurementType: _measurementType,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddHyperlink,
  onClearHyperlinks,
  onPreflightAutoHyperlink,
  onExecuteAutoHyperlink,
  onClearBatchHyperlinks,
  autoHyperlinkAvailable,
  currentDocumentId,
}: TakeoffWorkspaceHeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const helpWorkspaceState = useMemo(
    () => ({
      hasOpenPdf: Boolean(currentPdfFile),
      isCalibrating,
      isMeasuring,
      hasSelectedCondition,
    }),
    [currentPdfFile, isCalibrating, isMeasuring, hasSelectedCondition]
  );

  const handleZoomOut = () =>
    onScaleChange(Math.max(PDF_VIEWER_MIN_SCALE, scale - ZOOM_STEP));
  const handleZoomIn = () =>
    onScaleChange(Math.min(PDF_VIEWER_MAX_SCALE, scale + ZOOM_STEP));

  return (
    <div
      className="workspace-commandbar p-2"
      style={{
        paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))',
        paddingLeft: 'max(0.5rem, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(0.5rem, env(safe-area-inset-right, 0px))',
      }}
    >
      {/* Left - Back, Undo/Redo */}
      <div className="commandbar-zone commandbar-left">
        <Button
          variant="ghost"
          onClick={onBackToProjects}
          className="command-button flex items-center gap-2"
          title="Back to Projects"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span className="hidden lg:inline">Back to Projects</span>
        </Button>
        <div className="command-cluster">
          <Button size="sm" variant="ghost" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)" className="command-icon-button">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onRedo} disabled={!canRedo} title="Redo (⌘⇧Z)" className="command-icon-button">
            <Redo2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Center - Page nav, View (dropdown on small) or inline scale/rotate/calibrate (md+), Annotate */}
      <div className="commandbar-zone commandbar-center">
        <div className="command-cluster">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1 || !currentPdfFile}
            title="Previous page"
            className="command-button"
          >
            <ChevronLeft className="w-4 h-4 lg:hidden" />
            <span className="hidden lg:inline">Previous</span>
          </Button>
          <span className="metric-pill">
            {currentPdfFile ? `${currentPage} / ${totalPages}` : 'No PDF'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages || !currentPdfFile}
            title="Next page"
            className="command-button"
          >
            <ChevronRight className="w-4 h-4 lg:hidden" />
            <span className="hidden lg:inline">Next</span>
          </Button>
        </div>

        {/* View dropdown: scale, reset, rotate, calibrate - visible below lg to avoid mid-size overflow */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="xl:hidden command-button flex items-center gap-1 bg-background" title="View options">
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
                    onClick={handleZoomOut}
                    disabled={scale <= PDF_VIEWER_MIN_SCALE}
                    title="Zoom out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <span className="flex-1 text-center text-sm tabular-nums">{Math.round(scale * 100)}%</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={handleZoomIn}
                    disabled={scale >= PDF_VIEWER_MAX_SCALE}
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
            <div className="hidden xl:inline-flex command-cluster">
              <Button size="sm" variant="ghost" className="command-icon-button" onClick={handleZoomOut} disabled={scale <= PDF_VIEWER_MIN_SCALE} title="Zoom out">
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="metric-pill">{Math.round(scale * 100)}%</span>
              <Button size="sm" variant="ghost" className="command-icon-button" onClick={handleZoomIn} disabled={scale >= PDF_VIEWER_MAX_SCALE} title="Zoom in">
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" className="command-button" onClick={onResetView}>
                <Maximize2 className="w-4 h-4 mr-1.5" />
                Reset
              </Button>
            </div>
            <div className="hidden xl:inline-flex command-cluster">
              <Button size="sm" variant="ghost" className="command-icon-button" onClick={() => onRotatePage('counterclockwise')} title="Rotate counterclockwise">
                <RotateCcw className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" className="command-icon-button" onClick={() => onRotatePage('clockwise')} title="Rotate clockwise">
                <RotateCw className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}

        <div className="hidden xl:block">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCalibrateScale}
            className={cn(
              'command-button',
              isPageCalibrated ? 'command-button-success hover:opacity-90' : 'command-button-warning hover:opacity-90'
            )}
            title={isPageCalibrated ? 'Recalibrate' : 'Calibrate Scale'}
          >
            {isPageCalibrated ? 'Recalibrate' : 'Calibrate Scale'}
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant={annotationTool ? 'default' : 'outline'}
              className={cn('command-button', annotationTool ? 'command-button-active border-blue-200' : 'bg-background')}
              title="Annotate"
            >
              <Pencil className="w-4 h-4 shrink-0 xl:mr-1" />
              <span className="hidden xl:inline">Annotate</span>
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
              <span className="ml-auto text-xs text-muted-foreground">T</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onAnnotationToolChange(annotationTool === 'freehand-highlight' ? null : 'freehand-highlight')}
              className={annotationTool === 'freehand-highlight' ? 'bg-accent' : ''}
            >
              <Highlighter className="w-4 h-4 mr-2" />
              Highlighter  <span className="ml-auto text-xs text-muted-foreground">H</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Shapes</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => onAnnotationToolChange(annotationTool === 'arrow' ? null : 'arrow')}
              className={annotationTool === 'arrow' ? 'bg-accent' : ''}
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              Arrow
              <span className="ml-auto text-xs text-muted-foreground">A</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onAnnotationToolChange(annotationTool === 'rectangle' ? null : 'rectangle')}
              className={annotationTool === 'rectangle' ? 'bg-accent' : ''}
            >
              <Square className="w-4 h-4 mr-2" />
              Rectangle
              <span className="ml-auto text-xs text-muted-foreground">R</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onAnnotationToolChange(annotationTool === 'circle' ? null : 'circle')}
              className={annotationTool === 'circle' ? 'bg-accent' : ''}
            >
              <Circle className="w-4 h-4 mr-2" />
              Circle
              <span className="ml-auto text-xs text-muted-foreground">C</span>
            </DropdownMenuItem>
            {(annotationTool === 'rectangle' || annotationTool === 'circle') && (
              <DropdownMenuItem
                onClick={(e) => { e.preventDefault(); onAnnotationFilledChange(!annotationFilled); }}
                className={annotationFilled ? 'bg-accent' : ''}
              >
                <PaintBucket className="w-4 h-4 mr-2" />
                Filled
                <span className="ml-auto text-xs text-muted-foreground">{annotationFilled ? 'On' : 'Off'}</span>
              </DropdownMenuItem>
            )}
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

      {/* Right - Help, Settings, Ortho badge, Saved status */}
      <div className="commandbar-zone commandbar-right">
        <HelpMenu surface="workspace" workspaceState={helpWorkspaceState} />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          title="Tools"
          className="command-icon-button shrink-0"
        >
          <Wrench className="w-4 h-4" />
        </Button>
        {((isOrthoSnapping && isMeasuring) || (isCalibrating && isOrthoSnapping)) && (
          <div className="status-chip status-chip-success">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h18"/>
              <path d="M12 3v18"/>
            </svg>
            <span>Ortho</span>
          </div>
        )}
        <div className="status-chip" title="All changes saved">
          <div className="w-2 h-2 bg-green-500 rounded-full shrink-0" />
          <span className="hidden 2xl:inline">All changes saved</span>
        </div>
      </div>

      <ToolsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onAddHyperlink={onAddHyperlink}
        onClearHyperlinks={onClearHyperlinks}
        onPreflightAutoHyperlink={onPreflightAutoHyperlink}
        onExecuteAutoHyperlink={onExecuteAutoHyperlink}
        onClearBatchHyperlinks={onClearBatchHyperlinks}
        autoHyperlinkAvailable={autoHyperlinkAvailable}
        currentDocumentId={currentDocumentId ?? null}
      />
    </div>
  );
}
