import { create } from 'zustand';
import type { TakeoffMeasurement, ConditionCostBreakdown, ProjectCostBreakdown } from '../../types';
import { MeasurementCalculator } from '../../utils/measurementCalculation';
import { useConditionStore } from './conditionSlice';
import { useProjectStore } from './projectSlice';

export function compareMeasurementsByStackOrder(a: TakeoffMeasurement, b: TakeoffMeasurement): number {
  const oa = a.stackOrder ?? 0;
  const ob = b.stackOrder ?? 0;
  if (oa !== ob) return oa - ob;
  return a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id);
}

/** API/legacy rows may use string or number for pdf_page; keep page grouping consistent for z-order. */
function samePdfPageKey(a: number | string | undefined, b: number | string | undefined): boolean {
  return Number(a) === Number(b);
}

function supportsWasteFactor(type: string): boolean {
  return type !== 'count' && type !== 'auto-count';
}

const PENDING_MEASUREMENT_PREFIX = 'pending-measurement:';

/** True while a measurement is shown optimistically before the create API returns. */
export function isPendingMeasurementId(id: string): boolean {
  return id.startsWith(PENDING_MEASUREMENT_PREFIX);
}

function createPendingMeasurementId(): string {
  return `${PENDING_MEASUREMENT_PREFIX}${crypto.randomUUID()}`;
}

/** Create was aborted (user deleted pending markup or navigated away before save finished). */
export function isTakeoffMeasurementCreateAborted(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; name?: string };
  return e.code === 'ERR_CANCELED' || e.name === 'CanceledError' || e.name === 'AbortError';
}

const pendingCreateAbortById = new Map<string, AbortController>();

interface MeasurementState {
  // State
  takeoffMeasurements: TakeoffMeasurement[];
  markupsByPage: Record<string, TakeoffMeasurement[]>;
  loadingMeasurements: boolean;
  loadingMeasurementsProjectId: string | null;
  loadedPages: Set<string>;
  loadingPages: Set<string>;
  /** Clipboard for copy-paste: condition markups (takeoff measurements) copied by id */
  copiedMarkups: TakeoffMeasurement[];

  // Actions
  addTakeoffMeasurement: (measurement: Omit<TakeoffMeasurement, 'id' | 'timestamp'>) => Promise<string>;
  updateTakeoffMeasurement: (id: string, updates: Partial<TakeoffMeasurement>) => Promise<void>;
  /** Swap z-order with the neighbor on the same page (forward = toward front / on top). */
  reorderTakeoffMeasurementStack: (
    measurementId: string,
    direction: 'forward' | 'backward'
  ) => Promise<void>;
  /** Move this markup to the back-most layer (behind everything else on the page). */
  sendTakeoffMeasurementToBack: (measurementId: string) => Promise<void>;
  deleteTakeoffMeasurement: (id: string, options?: { awaitServer?: boolean }) => Promise<void>;
  clearProjectMeasurements: (projectId: string) => void;
  /** Clear measurements when switching project (so new project load is clean). */
  clearForProjectSwitch: (newProjectId: string) => void;
  /** Copy condition markups by ids into clipboard (for paste). */
  copyMarkupsByIds: (ids: string[]) => void;
  /** Recalculate existing measurements after calibration change (same project/sheet/page scope). */
  recalculateMeasurementsForCalibration: (
    projectId: string,
    sheetId: string,
    pageNumber: number | null,
    scaleFactor: number,
    unit: string,
    viewportWidth: number | null,
    viewportHeight: number | null
  ) => Promise<void>;

  // Page-based markup management
  getPageKey: (projectId: string, sheetId: string, pageNumber: number) => string;
  getPageMarkups: (projectId: string, sheetId: string, pageNumber: number) => TakeoffMeasurement[];
  updateMarkupsByPage: () => void;
  
  // Getters
  getSheetTakeoffMeasurements: (projectId: string, sheetId: string) => TakeoffMeasurement[];
  getPageTakeoffMeasurements: (projectId: string, sheetId: string, pageNumber: number) => TakeoffMeasurement[];
  getConditionTakeoffMeasurements: (projectId: string, conditionId: string) => TakeoffMeasurement[];
  getProjectTakeoffMeasurements: (projectId: string) => TakeoffMeasurement[];
  getProjectTakeoffSummary: (projectId: string) => {
    totalMeasurements: number;
    totalValue: number;
    byCondition: Record<string, { count: number; value: number; unit: string }>;
  };
  
  // Cost calculations
  getProjectTotalCost: (projectId: string) => number;
  getConditionCostBreakdown: (conditionId: string) => ConditionCostBreakdown | null;
  getProjectCostBreakdown: (projectId: string) => ProjectCostBreakdown;
  
  // Data loading
  loadProjectTakeoffMeasurements: (projectId: string) => Promise<void>;
  loadPageTakeoffMeasurements: (projectId: string, sheetId: string, pageNumber: number) => Promise<void>;
}

export const useMeasurementStore = create<MeasurementState>()((set, get) => {
  const persistStackOrderUpdates = async (
    stackUpdates: { id: string; stackOrder: number }[],
    logPrefix: string
  ) => {
    const { takeoffMeasurementService } = await import('../../services/apiService');
    const applyStackOrdersLocally = () => {
      const orderById = new Map(stackUpdates.map((u) => [u.id, u.stackOrder]));
      set((state) => ({
        takeoffMeasurements: state.takeoffMeasurements.map((meas) => {
          const so = orderById.get(meas.id);
          return so !== undefined ? { ...meas, stackOrder: so } : meas;
        }),
      }));
      get().updateMarkupsByPage();
    };
    applyStackOrdersLocally();
    const persistable = stackUpdates.filter((u) => !isPendingMeasurementId(u.id));
    let persistOk = persistable.length === 0;
    try {
      if (persistable.length > 0) {
        await takeoffMeasurementService.batchUpdateTakeoffMeasurementStackOrder(persistable);
        persistOk = true;
      }
    } catch (error: unknown) {
      console.warn(`${logPrefix}: batch stack-order failed, falling back to sequential PUT`, error);
      for (const u of persistable) {
        try {
          const response = await takeoffMeasurementService.updateTakeoffMeasurement(u.id, {
            stackOrder: u.stackOrder,
          });
          const row = (response as { measurement?: TakeoffMeasurement }).measurement;
          if (row) {
            set((state) => ({
              takeoffMeasurements: state.takeoffMeasurements.map((measurement) =>
                measurement.id === u.id ? { ...measurement, ...row } : measurement
              ),
            }));
          }
          persistOk = true;
        } catch (putErr: unknown) {
          console.error(`${logPrefix}: PUT stackOrder failed for ${u.id}`, putErr);
        }
      }
      get().updateMarkupsByPage();
    }
    if (!persistOk) {
      console.error(
        `${logPrefix}: stack order could not be saved to the server; UI keeps your last order locally. Check network and DB migration for stack_order.`
      );
    }
  };

  return {
    // Initial state
    takeoffMeasurements: [],
    markupsByPage: {},
    loadingMeasurements: false,
    loadingMeasurementsProjectId: null,
    loadedPages: new Set<string>(),
    loadingPages: new Set<string>(),
    copiedMarkups: [],

    // Actions
    copyMarkupsByIds: (ids) => {
      if (ids.length === 0) {
        set({ copiedMarkups: [] });
        return;
      }
      const { takeoffMeasurements } = get();
      const conditions = useConditionStore.getState().conditions;
      const copied = takeoffMeasurements.filter((m) => {
        if (!ids.includes(m.id)) return false;
        const cond = conditions.find((c) => c.id === m.conditionId);
        return cond?.type !== 'auto-count';
      });
      set({ copiedMarkups: copied });
    },

    addTakeoffMeasurement: async (measurementData) => {
      const { takeoffMeasurementService } = await import('../../services/apiService');

      const condition = useConditionStore.getState().getConditionById(measurementData.conditionId);
      const pageMeas = get().getPageTakeoffMeasurements(
        measurementData.projectId,
        measurementData.sheetId,
        measurementData.pdfPage
      );
      const maxOrder = pageMeas.reduce((acc, x) => Math.max(acc, x.stackOrder ?? 0), -1);
      const stackOrder = maxOrder + 1;
      const measurementPayload = {
        ...measurementData,
        stackOrder,
        conditionColor: condition?.color || '#000000',
        conditionName: condition?.name || 'Unknown',
        ...(measurementData.type === 'linear' && condition?.lineThickness != null && {
          conditionLineThickness: condition.lineThickness,
        }),
      };

      const optimisticId = createPendingMeasurementId();
      const optimistic: TakeoffMeasurement = {
        ...measurementPayload,
        id: optimisticId,
        timestamp: new Date().toISOString(),
      };

      const pageKey = `${measurementPayload.projectId}-${measurementPayload.sheetId}-${measurementPayload.pdfPage}`;
      set((state) => {
        const updatedLoadedPages = new Set(state.loadedPages);
        updatedLoadedPages.add(pageKey);
        return {
          takeoffMeasurements: [...state.takeoffMeasurements, optimistic],
          loadedPages: updatedLoadedPages,
        };
      });
      get().updateMarkupsByPage();

      const ac = new AbortController();
      pendingCreateAbortById.set(optimisticId, ac);

      try {
        const response = await takeoffMeasurementService.createTakeoffMeasurement(measurementPayload, {
          signal: ac.signal,
        });
        pendingCreateAbortById.delete(optimisticId);
        if (import.meta.env.DEV) console.log('✅ ADD_TAKEOFF_MEASUREMENT: API response received:', response);
        const measurement = response.measurement || response;

        set((state) => ({
          takeoffMeasurements: state.takeoffMeasurements.map((m) =>
            m.id === optimisticId ? measurement : m
          ),
        }));
        get().updateMarkupsByPage();

        if (import.meta.env.DEV) {
          console.log('✅ ADD_TAKEOFF_MEASUREMENT: Measurement created successfully with ID:', measurement.id);
        }
        return measurement.id;
      } catch (error: unknown) {
        pendingCreateAbortById.delete(optimisticId);
        if (isTakeoffMeasurementCreateAborted(error)) {
          set((state) => ({
            takeoffMeasurements: state.takeoffMeasurements.filter((m) => m.id !== optimisticId),
          }));
          get().updateMarkupsByPage();
          throw error;
        }
        console.error('❌ ADD_TAKEOFF_MEASUREMENT: Failed to create measurement via API:', error);
        set((state) => ({
          takeoffMeasurements: state.takeoffMeasurements.filter((m) => m.id !== optimisticId),
        }));
        get().updateMarkupsByPage();
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to create takeoff measurement: ${msg}`);
      }
    },
    
    updateTakeoffMeasurement: async (id, updates) => {
      if (isPendingMeasurementId(id)) {
        set((state) => ({
          takeoffMeasurements: state.takeoffMeasurements.map((measurement) =>
            measurement.id === id ? { ...measurement, ...updates } : measurement
          ),
        }));
        get().updateMarkupsByPage();
        return;
      }
      try {
        const { takeoffMeasurementService } = await import('../../services/apiService');
        
        console.log('🔄 UPDATE_TAKEOFF_MEASUREMENT: Updating measurement via API:', { id, updates });
        const response = await takeoffMeasurementService.updateTakeoffMeasurement(id, updates);
        console.log('✅ UPDATE_TAKEOFF_MEASUREMENT: API update successful:', response);
        const updatedMeasurement = response.measurement || response;
        
        set(state => ({
          takeoffMeasurements: state.takeoffMeasurements.map(measurement =>
            measurement.id === id ? { ...measurement, ...updatedMeasurement } : measurement
          )
        }));
        
        get().updateMarkupsByPage();
      } catch (error: unknown) {
        console.error('❌ UPDATE_TAKEOFF_MEASUREMENT: Failed to update measurement via API:', error);
        // Fallback to local update if API fails
        set(state => ({
          takeoffMeasurements: state.takeoffMeasurements.map(measurement =>
            measurement.id === id ? { ...measurement, ...updates } : measurement
          )
        }));
        
        get().updateMarkupsByPage();
      }
    },

    reorderTakeoffMeasurementStack: async (measurementId, direction) => {
      const { takeoffMeasurements } = get();
      const m = takeoffMeasurements.find((x) => x.id === measurementId);
      if (!m) return;
      const page = takeoffMeasurements.filter(
        (x) =>
          x.projectId === m.projectId &&
          x.sheetId === m.sheetId &&
          samePdfPageKey(x.pdfPage, m.pdfPage)
      );
      const sorted = [...page].sort(compareMeasurementsByStackOrder);
      const i = sorted.findIndex((x) => x.id === measurementId);
      if (i < 0) return;
      const j = direction === 'forward' ? i + 1 : i - 1;
      if (j < 0 || j >= sorted.length) return;
      const next = [...sorted];
      [next[i], next[j]] = [next[j], next[i]];
      const stackUpdates = next.map((meas, idx) => ({ id: meas.id, stackOrder: idx }));
      await persistStackOrderUpdates(stackUpdates, 'REORDER_STACK');
    },

    sendTakeoffMeasurementToBack: async (measurementId) => {
      const { takeoffMeasurements } = get();
      const m = takeoffMeasurements.find((x) => x.id === measurementId);
      if (!m) return;
      const page = takeoffMeasurements.filter(
        (x) =>
          x.projectId === m.projectId &&
          x.sheetId === m.sheetId &&
          samePdfPageKey(x.pdfPage, m.pdfPage)
      );
      const sorted = [...page].sort(compareMeasurementsByStackOrder);
      const i = sorted.findIndex((x) => x.id === measurementId);
      if (i < 0 || i === 0) return;
      const selected = sorted[i];
      const next = [selected, ...sorted.filter((x) => x.id !== measurementId)];
      const stackUpdates = next.map((meas, idx) => ({ id: meas.id, stackOrder: idx }));
      await persistStackOrderUpdates(stackUpdates, 'SEND_TO_BACK');
    },
    
    deleteTakeoffMeasurement: async (id, options) => {
      if (isPendingMeasurementId(id)) {
        const ac = pendingCreateAbortById.get(id);
        pendingCreateAbortById.delete(id);
        set((state) => ({
          takeoffMeasurements: state.takeoffMeasurements.filter((measurement) => measurement.id !== id),
        }));
        get().updateMarkupsByPage();
        ac?.abort();
        return;
      }

      const snapshot = get().takeoffMeasurements.find((m) => m.id === id);
      if (!snapshot) return;

      set((state) => ({
        takeoffMeasurements: state.takeoffMeasurements.filter((measurement) => measurement.id !== id),
      }));
      get().updateMarkupsByPage();

      const deleteFromServer = async () => {
        const { takeoffMeasurementService } = await import('../../services/apiService');
        await takeoffMeasurementService.deleteTakeoffMeasurement(id);
        if (import.meta.env.DEV) {
          console.log('✅ DELETE_TAKEOFF_MEASUREMENT: Measurement deleted successfully from API');
        }
      };

      const restore = () => {
        set((state) => ({
          takeoffMeasurements: [...state.takeoffMeasurements, snapshot],
        }));
        get().updateMarkupsByPage();
      };

      if (options?.awaitServer) {
        try {
          await deleteFromServer();
        } catch (error: unknown) {
          console.error('❌ DELETE_TAKEOFF_MEASUREMENT: Failed to delete measurement via API:', error);
          restore();
          const msg = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to delete takeoff measurement: ${msg}`);
        }
        return;
      }

      void deleteFromServer().catch((error: unknown) => {
        console.error('❌ DELETE_TAKEOFF_MEASUREMENT: Failed to delete measurement via API:', error);
        restore();
      });
    },
    
    clearProjectMeasurements: (projectId) => {
      set(state => ({
        takeoffMeasurements: state.takeoffMeasurements.filter(m => m.projectId !== projectId),
        markupsByPage: {}
      }));
      get().updateMarkupsByPage();
    },

    clearForProjectSwitch: (newProjectId) => {
      const projectStore = useProjectStore.getState();
      const state = get();
      const isSwitching = projectStore.currentProjectId !== newProjectId;
      const notLoadingNew = !state.loadingMeasurements || state.loadingMeasurementsProjectId !== newProjectId;
      if (isSwitching && notLoadingNew) {
        set({
          takeoffMeasurements: [],
          markupsByPage: {},
          loadingMeasurements: false,
          loadingMeasurementsProjectId: null
        });
      }
    },

    // Page-based markup management
    getPageKey: (projectId, sheetId, pageNumber) => {
      return `${projectId}-${sheetId}-${pageNumber}`;
    },
    
    getPageMarkups: (projectId, sheetId, pageNumber) => {
      const { markupsByPage } = get();
      const pageKey = get().getPageKey(projectId, sheetId, pageNumber);
      return markupsByPage[pageKey] || [];
    },
    
    updateMarkupsByPage: () => {
      const { takeoffMeasurements } = get();
      const markupsByPage: Record<string, TakeoffMeasurement[]> = {};
      
      takeoffMeasurements.forEach(measurement => {
        const pageKey = get().getPageKey(
          measurement.projectId,
          measurement.sheetId,
          Number(measurement.pdfPage) || 1
        );
        if (!markupsByPage[pageKey]) {
          markupsByPage[pageKey] = [];
        }
        markupsByPage[pageKey].push(measurement);
      });

      for (const key of Object.keys(markupsByPage)) {
        markupsByPage[key].sort(compareMeasurementsByStackOrder);
      }

      set({ markupsByPage });
    },

    recalculateMeasurementsForCalibration: async (
      projectId,
      sheetId,
      pageNumber,
      scaleFactor,
      unit,
      viewportWidth,
      viewportHeight
    ) => {
      if (viewportWidth == null || viewportHeight == null || viewportWidth <= 0 || viewportHeight <= 0) {
        if (import.meta.env.DEV) {
          console.warn('📐 RECALC_AFTER_CALIBRATION: Skipping recalculation - viewport dimensions required', {
            viewportWidth,
            viewportHeight
          });
        }
        return;
      }

      const measurements =
        pageNumber != null
          ? get().getPageTakeoffMeasurements(projectId, sheetId, pageNumber)
          : get().getSheetTakeoffMeasurements(projectId, sheetId);

      if (measurements.length === 0) {
        if (import.meta.env.DEV) {
          console.log('📐 RECALC_AFTER_CALIBRATION: No measurements to recalculate', {
            projectId,
            sheetId,
            pageNumber
          });
        }
        return;
      }

      const scaleInfo = {
        scaleFactor,
        unit,
        scaleText: 'calibrated',
        confidence: 0.95,
        viewportWidth,
        viewportHeight
      };

      const conditionStore = useConditionStore.getState();
      const updateTakeoffMeasurement = get().updateTakeoffMeasurement;

      const updatePromises: Promise<void>[] = [];

      for (const measurement of measurements) {
        if (isPendingMeasurementId(measurement.id)) {
          continue;
        }
        const points = measurement.pdfCoordinates?.length
          ? measurement.pdfCoordinates
          : measurement.points;

        if (!points || points.length === 0) {
          continue;
        }

        const condition = conditionStore.getConditionById(measurement.conditionId);
        if (!condition) {
          continue;
        }

        let calculatedValue = measurement.calculatedValue;
        let perimeterValue: number | undefined = measurement.perimeterValue;
        let areaValue: number | undefined = measurement.areaValue;
        let unitOut = measurement.unit;

        if (measurement.type === 'count') {
          // Count is always 1, no recalculation
          continue;
        }

        if (measurement.type === 'linear') {
          const result = MeasurementCalculator.calculateLinear(points, scaleInfo, 1.0);
          calculatedValue = result.calculatedValue;
          unitOut = result.unit;
          if (condition.includeHeight && condition.height) {
            areaValue = calculatedValue * condition.height;
          }
        } else if (measurement.type === 'area') {
          const result = MeasurementCalculator.calculateArea(points, scaleInfo, 1.0);
          calculatedValue = result.calculatedValue;
          unitOut = result.unit;
          if (condition.includePerimeter) {
            perimeterValue = result.perimeterValue;
          }
        } else if (measurement.type === 'volume') {
          const depth = condition.depth ?? 1;
          const result = MeasurementCalculator.calculateVolume(points, scaleInfo, depth, 1.0);
          calculatedValue = result.calculatedValue;
          unitOut = result.unit;
          if (condition.includePerimeter && result.perimeterValue != null) {
            perimeterValue = result.perimeterValue;
          }
        }

        // Recalculate cutouts with new scale if present
        let cutouts = measurement.cutouts;
        let netCalculatedValue: number | undefined;

        if (cutouts?.length) {
          const depth = condition.depth ?? 1;
          cutouts = cutouts.map(cutout => {
            const cutoutPoints = cutout.pdfCoordinates?.length ? cutout.pdfCoordinates : cutout.points;
            if (!cutoutPoints || cutoutPoints.length < 3) {
              return cutout;
            }
            const areaResult = MeasurementCalculator.calculateArea(cutoutPoints, scaleInfo, 1.0);
            const cutoutVal =
              measurement.type === 'volume'
                ? areaResult.calculatedValue * depth
                : areaResult.calculatedValue;
            return { ...cutout, calculatedValue: cutoutVal };
          });
          const totalCutoutValue = cutouts.reduce((sum, c) => sum + c.calculatedValue, 0);
          netCalculatedValue = Math.round((calculatedValue - totalCutoutValue) * 100) / 100;
        }

        const updates: Partial<TakeoffMeasurement> = {
          calculatedValue: Math.round(calculatedValue * 100) / 100,
          unit: unitOut,
          ...(perimeterValue !== undefined && { perimeterValue }),
          ...(areaValue !== undefined && { areaValue }),
          ...(cutouts && { cutouts }),
          ...(netCalculatedValue !== undefined && { netCalculatedValue })
        };

        updatePromises.push(
          updateTakeoffMeasurement(measurement.id, updates).catch(err => {
            console.error(`📐 RECALC_AFTER_CALIBRATION: Failed to update measurement ${measurement.id}`, err);
          })
        );
      }

      await Promise.all(updatePromises);
      get().updateMarkupsByPage();

      if (import.meta.env.DEV) {
        console.log('📐 RECALC_AFTER_CALIBRATION: Recalculated measurements', {
          projectId,
          sheetId,
          pageNumber,
          count: measurements.length
        });
      }
    },

    // Getters
    getSheetTakeoffMeasurements: (projectId, sheetId) => {
      const { takeoffMeasurements } = get();
      return takeoffMeasurements.filter(m => m.projectId === projectId && m.sheetId === sheetId);
    },
    
    getPageTakeoffMeasurements: (projectId, sheetId, pageNumber) => {
      const { takeoffMeasurements } = get();
      return takeoffMeasurements
        .filter(m =>
          m.projectId === projectId &&
          m.sheetId === sheetId &&
          samePdfPageKey(m.pdfPage, pageNumber)
        )
        .sort(compareMeasurementsByStackOrder);
    },
    
    getConditionTakeoffMeasurements: (projectId, conditionId) => {
      const { takeoffMeasurements } = get();
      return takeoffMeasurements.filter(m => m.projectId === projectId && m.conditionId === conditionId);
    },
    
    getProjectTakeoffMeasurements: (projectId) => {
      const { takeoffMeasurements } = get();
      return takeoffMeasurements.filter(m => m.projectId === projectId);
    },
    
    getProjectTakeoffSummary: (projectId) => {
      const { takeoffMeasurements } = get();
      const conditions = useConditionStore.getState().conditions;
      
      const summary: {
        totalMeasurements: number;
        totalValue: number;
        byCondition: Record<string, { count: number; value: number; unit: string }>;
      } = {
        totalMeasurements: 0,
        totalValue: 0,
        byCondition: {}
      };

      takeoffMeasurements.forEach(measurement => {
        if (measurement.projectId === projectId) {
          summary.totalMeasurements++;
          const condition = conditions.find(c => c.id === measurement.conditionId);
          if (condition) {
            if (!summary.byCondition[condition.id]) {
              summary.byCondition[condition.id] = { count: 0, value: 0, unit: condition.unit };
            }
            summary.byCondition[condition.id].count++;
            summary.byCondition[condition.id].value += measurement.calculatedValue;
          }
        }
      });

      return summary;
    },
    
    // Cost calculations
    getProjectTotalCost: (projectId) => {
      const costBreakdown = get().getProjectCostBreakdown(projectId);
      return costBreakdown.summary.totalCost;
    },
    
    getConditionCostBreakdown: (conditionId) => {
      const { takeoffMeasurements } = get();
      const condition = useConditionStore.getState().getConditionById(conditionId);
      
      if (!condition) {
        return null;
      }
      
      const conditionMeasurements = takeoffMeasurements.filter(m => m.conditionId === conditionId);
      
      const quantity = conditionMeasurements.reduce((sum, measurement) => {
        const value = measurement.netCalculatedValue !== undefined && measurement.netCalculatedValue !== null 
          ? measurement.netCalculatedValue 
          : measurement.calculatedValue;
        return sum + (value || 0);
      }, 0);
      
      const wasteFactor = supportsWasteFactor(condition.type) ? (condition.wasteFactor || 0) : 0;
      const adjustedQuantity = quantity * (1 + wasteFactor / 100);
      
      const materialCostPerUnit = condition.materialCost || 0;
      const equipmentCost = condition.equipmentCost || 0;
      
      const materialCost = adjustedQuantity * materialCostPerUnit;
      const wasteCost = (adjustedQuantity - quantity) * materialCostPerUnit;
      
      const subtotal = materialCost + equipmentCost + wasteCost;
      
      return {
        condition,
        quantity,
        adjustedQuantity,
        materialCost,
        equipmentCost,
        wasteCost,
        subtotal,
        hasCosts: materialCostPerUnit > 0 || equipmentCost > 0
      };
    },
    
    getProjectCostBreakdown: (projectId) => {
      const conditions = useConditionStore.getState().getProjectConditions(projectId);
      const currentProject = useProjectStore.getState().getCurrentProject();
      
      const conditionBreakdowns: ConditionCostBreakdown[] = conditions
        .map(condition => get().getConditionCostBreakdown(condition.id))
        .filter((b): b is NonNullable<typeof b> => b != null);
      
      let totalMaterialCost = 0;
      let totalEquipmentCost = 0;
      let totalWasteCost = 0;
      let conditionsWithCosts = 0;
      
      conditionBreakdowns.forEach(breakdown => {
        totalMaterialCost += breakdown.materialCost;
        totalEquipmentCost += breakdown.equipmentCost;
        totalWasteCost += breakdown.wasteCost;
        
        if (breakdown.hasCosts) {
          conditionsWithCosts++;
        }
      });
      
      const subtotal = totalMaterialCost + totalEquipmentCost + totalWasteCost;
      
      const profitMarginPercent = currentProject?.profitMarginPercent || 15;
      const profitMarginAmount = subtotal * (profitMarginPercent / 100);
      const totalCost = subtotal + profitMarginAmount;
      
      return {
        conditions: conditionBreakdowns,
        summary: {
          totalMaterialCost,
          totalEquipmentCost,
          totalWasteCost,
          subtotal,
          profitMarginPercent,
          profitMarginAmount,
          totalCost,
          conditionsWithCosts,
          totalConditions: conditions.length
        }
      };
    },
    
    // Data loading
    loadProjectTakeoffMeasurements: async (projectId: string) => {
      const state = get();
      const projectStore = useProjectStore.getState();
      
      // RACE CONDITION PREVENTION: If already loading for this project, skip
      if (state.loadingMeasurements && state.loadingMeasurementsProjectId === projectId) {
        console.log('⏭️ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Already loading measurements for project', projectId, '- skipping duplicate request');
        return;
      }
      
      // RACE CONDITION PREVENTION: If project changed while we were about to load, abort
      if (projectStore.currentProjectId !== projectId) {
        console.log('⏭️ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Project changed from', projectId, 'to', projectStore.currentProjectId, '- aborting load');
        return;
      }
      
      console.log('🔄 LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Starting to load measurements for project:', projectId);
      
      set({ 
        loadingMeasurements: true,
        loadingMeasurementsProjectId: projectId
      });
      
      try {
        const { takeoffMeasurementService } = await import('../../services/apiService');
        
        console.log('🔄 LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Calling API to get project measurements from Supabase...');
        const measurementsResponse = await takeoffMeasurementService.getProjectTakeoffMeasurements(projectId);
        console.log('✅ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: API response received:', measurementsResponse);
        
        // RACE CONDITION PREVENTION: Double-check project hasn't changed during async operation
        const currentProjectStore = useProjectStore.getState();
        if (currentProjectStore.currentProjectId !== projectId) {
          console.log('⏭️ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Project changed during load from', projectId, 'to', currentProjectStore.currentProjectId, '- discarding results');
          set({ 
            loadingMeasurements: false,
            loadingMeasurementsProjectId: null
          });
          return;
        }
        
        const projectMeasurements = measurementsResponse.measurements || [];

        set((state) => {
          const otherProjectMeasurements = state.takeoffMeasurements.filter((m) => m.projectId !== projectId);
          const pendingForProject = state.takeoffMeasurements.filter(
            (m) => m.projectId === projectId && isPendingMeasurementId(m.id)
          );
          const byId = new Map(state.takeoffMeasurements.map((m) => [m.id, m]));

          // Prefer store stackOrder when we already have this row: in-flight GETs often return
          // stack_order from before the latest batch/PUT completed, which overwrote optimistic order.
          const mergedProject = projectMeasurements.map((m: TakeoffMeasurement) => {
            const existing = byId.get(m.id);
            if (existing) {
              return { ...existing, ...m, stackOrder: existing.stackOrder ?? m.stackOrder ?? 0 };
            }
            return m;
          });

          const allMeasurements = [...otherProjectMeasurements, ...mergedProject, ...pendingForProject];
          console.log(`💾 LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Loaded ${projectMeasurements.length} measurements from Supabase for project ${projectId}`, {
            projectMeasurementsCount: projectMeasurements.length,
            totalMeasurementsInStore: allMeasurements.length,
            source: 'Supabase',
          });
          return {
            takeoffMeasurements: allMeasurements,
            loadingMeasurements: false,
            loadingMeasurementsProjectId: null,
          };
        });
        
        get().updateMarkupsByPage();
        
        console.log(`✅ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Project measurements loaded from Supabase for ${projectId}:`, projectMeasurements.length);
      } catch (error) {
        console.error(`❌ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Failed to load measurements for project ${projectId} from Supabase:`, error);
        
        // Keep existing measurements on failure (network/CORS/etc.); clearing looked like "all markups vanished".
        set({
          loadingMeasurements: false,
          loadingMeasurementsProjectId: null,
        });
      }
    },

    loadPageTakeoffMeasurements: async (projectId: string, sheetId: string, pageNumber: number) => {
      const pageKey = `${projectId}-${sheetId}-${pageNumber}`;
      const state = get();
      
      if (state.loadedPages.has(pageKey)) {
        return;
      }
      
      if (state.loadingPages.has(pageKey)) {
        return;
      }
      
      set(state => {
        const updatedLoadingPages = new Set(state.loadingPages);
        updatedLoadingPages.add(pageKey);
        return { loadingPages: updatedLoadingPages };
      });
      
      try {
        const { takeoffMeasurementService } = await import('../../services/apiService');

        const response = await takeoffMeasurementService.getPageTakeoffMeasurements(sheetId, pageNumber);
        const pageMeasurements = response.measurements || [];

        set((state) => {
          const existingIds = new Set(state.takeoffMeasurements.map((m: TakeoffMeasurement) => m.id));
          // Merge server rows into existing measurements so fields like stackOrder stay in sync
          // when the same page is loaded again or after reorder elsewhere.
          const merged = state.takeoffMeasurements.map((m) => {
            const fresh = pageMeasurements.find((p: TakeoffMeasurement) => p.id === m.id);
            if (!fresh) return m;
            return {
              ...m,
              ...fresh,
              stackOrder: m.stackOrder ?? fresh.stackOrder ?? 0,
            };
          });
          const newMeasurements = pageMeasurements.filter((m: TakeoffMeasurement) => !existingIds.has(m.id));

          const updatedLoadedPages = new Set(state.loadedPages);
          updatedLoadedPages.add(pageKey);
          const updatedLoadingPages = new Set(state.loadingPages);
          updatedLoadingPages.delete(pageKey);

          return {
            takeoffMeasurements: [...merged, ...newMeasurements],
            loadedPages: updatedLoadedPages,
            loadingPages: updatedLoadingPages,
          };
        });
        
        get().updateMarkupsByPage();
        
      } catch (error) {
        console.error(`❌ LOAD_PAGE_TAKEOFF_MEASUREMENTS: Failed to load measurements for page ${pageNumber} of sheet ${sheetId}:`, error);
        
        set(state => {
          const updatedLoadingPages = new Set(state.loadingPages);
          updatedLoadingPages.delete(pageKey);
          return { loadingPages: updatedLoadingPages };
        });
      }
    },
  };
});
