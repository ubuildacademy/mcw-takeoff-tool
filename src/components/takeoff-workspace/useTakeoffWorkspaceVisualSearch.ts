import { useState, useRef, useCallback } from 'react';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import { useConditionStore } from '../../store/slices/conditionSlice';
import type { TakeoffCondition, Sheet, ProjectFile } from '../../types';

export interface AutoCountProgress {
  current: number;
  total: number;
  currentPage?: number;
  currentDocument?: string;
}

export interface AutoCountCompletionResult {
  success: boolean;
  matchesFound: number;
  measurementsCreated: number;
  message?: string;
}

export interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UseTakeoffWorkspaceVisualSearchOptions {
  projectId: string | undefined;
  currentPdfFile: ProjectFile | null;
  currentPage: number;
  selectedSheet: Sheet | null;
  isDev?: boolean;
}

export interface UseTakeoffWorkspaceVisualSearchResult {
  visualSearchMode: boolean;
  setVisualSearchMode: (value: boolean) => void;
  visualSearchCondition: TakeoffCondition | null;
  setVisualSearchCondition: (condition: TakeoffCondition | null) => void;
  selectionBox: SelectionBox | null;
  setSelectionBox: (box: SelectionBox | null) => void;
  visualSearchLoading: boolean;
  autoCountProgress: AutoCountProgress | null;
  showAutoCountProgress: boolean;
  setShowAutoCountProgress: (value: boolean) => void;
  setAutoCountProgress: (value: AutoCountProgress | null) => void;
  isCancellingAutoCount: boolean;
  setIsCancellingAutoCount: (value: boolean) => void;
  autoCountCompletionResult: AutoCountCompletionResult | null;
  setAutoCountCompletionResult: (value: AutoCountCompletionResult | null) => void;
  autoCountAbortControllerRef: React.MutableRefObject<AbortController | null>;
  handleVisualSearchComplete: (selectionBox: SelectionBox) => Promise<void>;
}

export function useTakeoffWorkspaceVisualSearch({
  projectId,
  currentPdfFile,
  currentPage,
  selectedSheet,
  isDev = false,
}: UseTakeoffWorkspaceVisualSearchOptions): UseTakeoffWorkspaceVisualSearchResult {
  const [visualSearchMode, setVisualSearchMode] = useState(false);
  const [visualSearchCondition, setVisualSearchCondition] = useState<TakeoffCondition | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [visualSearchLoading, setVisualSearchLoading] = useState(false);
  const [autoCountProgress, setAutoCountProgress] = useState<AutoCountProgress | null>(null);
  const [showAutoCountProgress, setShowAutoCountProgress] = useState(false);
  const [isCancellingAutoCount, setIsCancellingAutoCount] = useState(false);
  const [autoCountCompletionResult, setAutoCountCompletionResult] = useState<AutoCountCompletionResult | null>(null);
  const autoCountAbortControllerRef = useRef<AbortController | null>(null);

  const loadProjectTakeoffMeasurements = useMeasurementStore((s) => s.loadProjectTakeoffMeasurements);
  const loadProjectConditions = useConditionStore((s) => s.loadProjectConditions);

  const handleVisualSearchComplete = useCallback(
    async (box: SelectionBox) => {
      setVisualSearchLoading(true);

      if (!visualSearchCondition) {
        alert('Auto-count condition is missing. Please select an auto-count condition.');
        setVisualSearchLoading(false);
        setVisualSearchMode(false);
        setVisualSearchCondition(null);
        return;
      }

      const takeoffMeasurements = useMeasurementStore.getState().takeoffMeasurements;
      const existingMeasurements = takeoffMeasurements.filter((m) => m.conditionId === visualSearchCondition.id);
      if (existingMeasurements.length > 0) {
        alert(
          `This auto-count condition already has ${existingMeasurements.length} measurements. Please delete the condition and recreate it to run a new search.`
        );
        setVisualSearchLoading(false);
        setVisualSearchMode(false);
        setVisualSearchCondition(null);
        return;
      }

      if (!currentPdfFile) {
        alert('No PDF file is open. Please open a PDF file first.');
        setVisualSearchLoading(false);
        setVisualSearchMode(false);
        setVisualSearchCondition(null);
        return;
      }

      if (!projectId) {
        alert('Project ID is missing. Please refresh the page.');
        setVisualSearchLoading(false);
        setVisualSearchMode(false);
        setVisualSearchCondition(null);
        return;
      }

      const effectiveSheet: Sheet =
        selectedSheet ||
        {
          id: currentPdfFile.id,
          name: currentPdfFile.originalName?.replace('.pdf', '') || `Page ${currentPage}`,
          pageNumber: currentPage,
          isVisible: true,
          hasTakeoffs: false,
          takeoffCount: 0,
        };

      try {
        const { autoCountService } = await import('../../services/visualSearchService');
        const searchOptions = {
          confidenceThreshold: visualSearchCondition.searchThreshold ?? 0.7,
          maxMatches: 10000,
        };
        const searchScope = visualSearchCondition.searchScope ?? 'current-page';

        const abortController = new AbortController();
        autoCountAbortControllerRef.current = abortController;

        setShowAutoCountProgress(true);
        setAutoCountProgress({ current: 0, total: 1 });
        setIsCancellingAutoCount(false);
        setAutoCountCompletionResult(null);

        const onProgress = (progress: AutoCountProgress) => {
          if (!abortController.signal.aborted) {
            setAutoCountProgress(progress);
          }
        };

        let result;
        try {
          result = await autoCountService.completeSearch(
            visualSearchCondition.id,
            currentPdfFile.id,
            effectiveSheet.pageNumber,
            box,
            projectId,
            effectiveSheet.id,
            searchOptions,
            searchScope as 'current-page' | 'entire-document' | 'entire-project',
            onProgress,
            abortController.signal
          );
        } finally {
          autoCountAbortControllerRef.current = null;
        }

        if (isDev) console.log(`✅ Auto-count complete: ${result.measurementsCreated} matches found and marked`);

        await loadProjectTakeoffMeasurements(projectId);
        await loadProjectConditions(projectId);

        const updatedTakeoffMeasurements = useMeasurementStore.getState().takeoffMeasurements;
        const conditionMeasurements = updatedTakeoffMeasurements.filter(
          (m) => m.conditionId === visualSearchCondition.id
        );

        if (result.measurementsCreated > 0) {
          setAutoCountCompletionResult({
            success: true,
            matchesFound: result.measurementsCreated,
            measurementsCreated: conditionMeasurements.length,
          });
        } else {
          setAutoCountCompletionResult({
            success: false,
            matchesFound: 0,
            measurementsCreated: 0,
            message: `Try:\n• Lowering the confidence threshold (currently ${searchOptions.confidenceThreshold})\n• Selecting a more distinctive symbol\n• Ensuring the symbol appears multiple times`,
          });
        }
      } catch (error: unknown) {
        autoCountAbortControllerRef.current = null;
        setShowAutoCountProgress(false);
        setAutoCountProgress(null);
        setIsCancellingAutoCount(false);

        if (isDev) console.error('❌ Auto-count failed:', error);

        const err = error as { name?: string; message?: string };
        if (err?.name === 'AbortError' || err?.message?.includes('cancelled') || err?.message?.includes('aborted')) {
          setVisualSearchMode(false);
          setVisualSearchCondition(null);
          setSelectionBox(null);
          return;
        }

        const errorMessage = err?.message ?? 'Auto-count failed. Please try again.';
        if (errorMessage.includes('already has measurements')) {
          alert(
            'This condition already has measurements. Please delete the condition and recreate it to run a new search.'
          );
        } else {
          alert(`Auto-count failed: ${errorMessage}`);
        }
        setVisualSearchMode(false);
        setVisualSearchCondition(null);
        setSelectionBox(null);
      } finally {
        setVisualSearchLoading(false);
      }
    },
    [
      visualSearchCondition,
      currentPdfFile,
      projectId,
      currentPage,
      selectedSheet,
      loadProjectTakeoffMeasurements,
      loadProjectConditions,
      isDev,
    ]
  );

  return {
    visualSearchMode,
    setVisualSearchMode,
    visualSearchCondition,
    setVisualSearchCondition,
    selectionBox,
    setSelectionBox,
    visualSearchLoading,
    autoCountProgress,
    showAutoCountProgress,
    setShowAutoCountProgress,
    setAutoCountProgress,
    isCancellingAutoCount,
    setIsCancellingAutoCount,
    autoCountCompletionResult,
    setAutoCountCompletionResult,
    autoCountAbortControllerRef,
    handleVisualSearchComplete,
  };
}
