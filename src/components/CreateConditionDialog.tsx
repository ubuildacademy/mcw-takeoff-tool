import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useConditionStore } from '../store/slices/conditionSlice';
import { useConditionFolderStore } from '../store/slices/conditionFolderSlice';
import type { TakeoffCondition } from '../types';
import { generateDistinctColor, parseDepthInput, formatDepthOutput } from '../utils/commonUtils';

interface CreateConditionDialogProps {
  projectId: string;
  onClose: () => void;
  onConditionCreated: (condition: TakeoffCondition) => void;
  onConditionSelect?: (condition: TakeoffCondition) => void;
  editingCondition?: TakeoffCondition | null;
}

type ConditionFormType = 'area' | 'volume' | 'linear' | 'count' | 'auto-count';

function isCountLikeCondition(type: ConditionFormType): boolean {
  return type === 'count' || type === 'auto-count';
}

function getImageSrc(img: string): string {
  return img.startsWith('data:') || img.startsWith('http') ? img : `data:image/png;base64,${img}`;
}

function getDefaultUnit(type: string, includeHeight?: boolean): string {
  switch (type) {
    case 'area': return 'SF';
    case 'volume': return 'CY';
    case 'linear': return includeHeight ? 'SF' : 'LF';
    case 'count': return 'EA';
    case 'auto-count': return 'EA';
    default: return '';
  }
}

export function CreateConditionDialog({ projectId, onClose, onConditionCreated, onConditionSelect, editingCondition }: CreateConditionDialogProps) {
  const addCondition = useConditionStore((s) => s.addCondition);
  const updateCondition = useConditionStore((s) => s.updateCondition);
  const conditions = useConditionStore(useShallow((s) => s.conditions));
  const folders = useConditionFolderStore((s) => s.getFolders(projectId));
  const ensureFoldersLoaded = useConditionFolderStore((s) => s.ensureFoldersLoaded);

  useEffect(() => { ensureFoldersLoaded(projectId); }, [projectId, ensureFoldersLoaded]);

  const [formData, setFormData] = useState({
    name: editingCondition?.name || '',
    type: (editingCondition?.type || 'area') as ConditionFormType,
    unit: editingCondition?.unit || getDefaultUnit(editingCondition?.type || 'area', editingCondition?.includeHeight ?? false),
    wasteFactor: editingCondition?.wasteFactor?.toString() || '',
    color: editingCondition?.color || generateDistinctColor(conditions.filter((c: { projectId: string; color?: string }) => c.projectId === projectId).map((c: { color?: string }) => c.color).filter((color): color is string => typeof color === 'string')),
    description: editingCondition?.description || '',
    materialCost: editingCondition?.materialCost != null ? editingCondition.materialCost.toString() : '',
    equipmentCost: editingCondition?.equipmentCost != null ? editingCondition.equipmentCost.toString() : '',
    includePerimeter: editingCondition?.includePerimeter || false,
    depth: editingCondition?.depth ? formatDepthOutput(editingCondition.depth) : '',
    includeHeight: editingCondition?.includeHeight || false,
    height: editingCondition?.height ? formatDepthOutput(editingCondition.height) : '',
    lineThickness: editingCondition?.lineThickness?.toString() || '2',
    markerShape: (editingCondition?.markerShape || 'circle') as 'circle' | 'triangle' | 'square' | 'star' | 'checkmark',
    // Auto-count specific fields
    searchImage: editingCondition?.searchImage || '',
    searchImageId: editingCondition?.searchImageId || '',
    searchThreshold: editingCondition?.searchThreshold?.toString() || '0.7',
    searchScope: editingCondition?.searchScope || 'current-page' as 'current-page' | 'entire-document' | 'entire-project',
    folderId: editingCondition?.folderId ?? null,
    multiplier: editingCondition?.multiplier?.toString() || '',
    subQuantityType: (editingCondition?.subQuantityType || '') as '' | 'linear' | 'area' | 'volume',
    subQuantityUnit: editingCondition?.subQuantityUnit || '',
    subQuantityPerCount: editingCondition?.subQuantityPerCount?.toString() || '',
  });
  const [loading, setLoading] = useState(false);
  const [depthError, setDepthError] = useState<string>('');
  const [heightError, setHeightError] = useState<string>('');
  // For future auto-count: manual image upload + preview (currently symbol comes from PDF selection)
  const [_imagePreview, _setImagePreview] = useState<string | null>(null);
  const [_imageFile, _setImageFile] = useState<File | null>(null);

  // Ensure unit is set when component mounts
  useEffect(() => {
    if (!formData.unit) {
      const defaultUnit = getDefaultUnit(formData.type, formData.includeHeight);
      setFormData(prev => ({ ...prev, unit: defaultUnit }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount to set default unit
  }, []);

  // Sync form when editingCondition changes (e.g. opening to edit a different condition)
  useEffect(() => {
    if (!editingCondition) return;
    setFormData({
      name: editingCondition.name || '',
      type: (editingCondition.type || 'area') as ConditionFormType,
      unit: editingCondition.unit || getDefaultUnit(editingCondition.type, editingCondition.includeHeight),
      wasteFactor: editingCondition.wasteFactor?.toString() || '',
      color: editingCondition.color || generateDistinctColor(conditions.filter((c: { projectId: string; color?: string }) => c.projectId === projectId).map((c: { color?: string }) => c.color).filter((color): color is string => typeof color === 'string')),
      description: editingCondition.description || '',
      materialCost: editingCondition.materialCost != null ? editingCondition.materialCost.toString() : '',
      equipmentCost: editingCondition.equipmentCost != null ? editingCondition.equipmentCost.toString() : '',
      includePerimeter: editingCondition.includePerimeter || false,
      depth: editingCondition.depth ? formatDepthOutput(editingCondition.depth) : '',
      includeHeight: editingCondition.includeHeight || false,
      height: editingCondition.height ? formatDepthOutput(editingCondition.height) : '',
      lineThickness: editingCondition.lineThickness?.toString() || '2',
      markerShape: (editingCondition.markerShape || 'circle') as 'circle' | 'triangle' | 'square' | 'star' | 'checkmark',
      searchImage: editingCondition.searchImage || '',
      searchImageId: editingCondition.searchImageId || '',
      searchThreshold: editingCondition.searchThreshold?.toString() || '0.7',
      searchScope: (editingCondition.searchScope || 'current-page') as 'current-page' | 'entire-document' | 'entire-project',
      folderId: editingCondition.folderId ?? null,
      multiplier: editingCondition.multiplier?.toString() || '',
      subQuantityType: (editingCondition.subQuantityType || '') as '' | 'linear' | 'area' | 'volume',
      subQuantityUnit: editingCondition.subQuantityUnit || '',
      subQuantityPerCount: editingCondition.subQuantityPerCount?.toString() || '',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Sync only when switching to edit a condition
  }, [editingCondition?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      
      // Parse depth value (supports both decimal feet and feet/inches format)
      // Depth is required for volume conditions
      let parsedDepth: number | null | undefined;
      if (formData.type === 'volume') {
        if (!formData.depth || formData.depth.trim() === '') {
          setDepthError('Depth is required for volume conditions');
          setLoading(false);
          return;
        }
        parsedDepth = parseDepthInput(formData.depth);
        if (parsedDepth === null) {
          setDepthError('Invalid depth format. Use decimal feet (e.g., 1.5) or feet/inches (e.g., 1\'6")');
          setLoading(false);
          return;
        }
        if (parsedDepth <= 0) {
          setDepthError('Depth must be greater than 0');
          setLoading(false);
          return;
        }
      } else if (formData.depth && formData.depth.trim() !== '') {
        parsedDepth = parseDepthInput(formData.depth);
        if (parsedDepth === null) {
          setDepthError('Invalid depth format. Use decimal feet (e.g., 1.5) or feet/inches (e.g., 1\'6")');
          setLoading(false);
          return;
        }
      }

      // Parse height value (supports both decimal feet and feet/inches format)
      // Height is required when includeHeight is checked for linear conditions
      let parsedHeight: number | null | undefined;
      if (formData.type === 'linear' && formData.includeHeight) {
        if (!formData.height || formData.height.trim() === '') {
          setHeightError('Height is required when height calculation is enabled');
          setLoading(false);
          return;
        }
        parsedHeight = parseDepthInput(formData.height);
        if (parsedHeight === null) {
          setHeightError('Invalid height format. Use decimal feet (e.g., 1.5) or feet/inches (e.g., 1\'6")');
          setLoading(false);
          return;
        }
        if (parsedHeight <= 0) {
          setHeightError('Height must be greater than 0');
          setLoading(false);
          return;
        }
      } else if (formData.height && formData.height.trim() !== '') {
        parsedHeight = parseDepthInput(formData.height);
        if (parsedHeight === null) {
          setHeightError('Invalid height format. Use decimal feet (e.g., 1.5) or feet/inches (e.g., 1\'6")');
          setLoading(false);
          return;
        }
      }

      const conditionData = {
        projectId,
        name: formData.name,
        type: formData.type,
        unit: effectiveUnit,
        wasteFactor: isCountLikeCondition(formData.type)
          ? 0
          : (formData.wasteFactor ? parseFloat(formData.wasteFactor) : 0),
        color: formData.color,
        description: formData.description,
        materialCost: formData.materialCost && formData.materialCost.trim() !== '' ? parseFloat(formData.materialCost) : undefined,
        // Always send equipmentCost, even if 0 or empty, to ensure it persists
        equipmentCost: formData.equipmentCost !== '' && formData.equipmentCost !== null && formData.equipmentCost !== undefined 
          ? (formData.equipmentCost.trim() !== '' ? parseFloat(formData.equipmentCost) : 0)
          : 0,
        includePerimeter: formData.includePerimeter,
        depth: parsedDepth === null || parsedDepth === undefined ? undefined : parsedDepth,
        includeHeight: formData.includeHeight,
        height: parsedHeight === null || parsedHeight === undefined ? undefined : parsedHeight,
        lineThickness: formData.type === 'linear' && formData.lineThickness
          ? Math.max(1, Math.min(8, parseInt(formData.lineThickness, 10) || 2))
          : undefined,
        ...(isCountLikeCondition(formData.type) && { markerShape: formData.markerShape }),
        // Auto-count specific fields
        ...(formData.type === 'auto-count' && {
          searchImage: formData.searchImage,
          searchImageId: formData.searchImageId,
          searchThreshold: formData.searchThreshold ? parseFloat(formData.searchThreshold) : 0.7,
          searchScope: formData.searchScope || 'current-page'
        }),
        folderId: formData.folderId ?? null,
        ...(formData.multiplier && parseInt(formData.multiplier, 10) > 1
          ? { multiplier: parseInt(formData.multiplier, 10) }
          : { multiplier: undefined }),
        // Sub-quantity: only for count/auto-count with a valid type and value.
        // When clearing (no type or value), send undefined so server skips the field
        // unless we were editing an existing condition that had sub-qty (then send null to clear it).
        ...(isCountLikeCondition(formData.type) && formData.subQuantityType && formData.subQuantityPerCount && parseFloat(formData.subQuantityPerCount) > 0
          ? {
              subQuantityType: formData.subQuantityType,
              subQuantityUnit: formData.subQuantityUnit || (formData.subQuantityType === 'linear' ? 'LF' : formData.subQuantityType === 'area' ? 'SF' : 'CY'),
              subQuantityPerCount: parseFloat(formData.subQuantityPerCount),
            }
          : editingCondition?.subQuantityType
            ? { subQuantityType: null as unknown as undefined, subQuantityUnit: null as unknown as undefined, subQuantityPerCount: null as unknown as undefined }
            : {}),
      };
      
      let result: TakeoffCondition;
      let createdCondition: TakeoffCondition | null = null;
      
      if (editingCondition) {
        await updateCondition(editingCondition.id, conditionData);
        result = editingCondition;
      } else {
        const conditionId = await addCondition(conditionData);
        const store = useConditionStore.getState();
        createdCondition = store.conditions.find((c): c is TakeoffCondition => c.id === conditionId) ?? null;
        result = createdCondition ?? { id: conditionId, ...conditionData } as TakeoffCondition;
      }
      
      // Call the callback with the result
      onConditionCreated(result);
      
      // Auto-select auto-count conditions after creation to enable selection mode
      if (!editingCondition && createdCondition && createdCondition.type === 'auto-count' && onConditionSelect) {
        // Small delay to ensure condition is fully created and UI is updated
        setTimeout(() => {
          onConditionSelect(createdCondition);
        }, 100);
      }
      
    } catch (error) {
      console.error('Error saving condition:', error);
      toast.error(`Failed to ${editingCondition ? 'update' : 'create'} condition. Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string | number | boolean | null) => {
    setFormData(prev => {
      const newData = { ...prev, [field]: value };
      
      // Auto-switch unit to SF when includeHeight is checked for linear conditions
      if (field === 'includeHeight' && value === true && prev.type === 'linear') {
        newData.unit = 'SF';
      }
      // Reset unit to LF and clear height when includeHeight is unchecked for linear conditions
      if (field === 'includeHeight' && value === false && prev.type === 'linear') {
        newData.unit = 'LF';
        newData.height = '';
      }
      
      return newData;
    });
    
    // Clear depth error when user starts typing
    if (field === 'depth' && depthError) {
      setDepthError('');
    }
    
    // Clear height error when user starts typing
    if (field === 'height' && heightError) {
      setHeightError('');
    }
  };

  const handleTypeChange = (value: string) => {
    const defaultUnit = getDefaultUnit(value);
    setFormData(prev => {
      const newData = {
        ...prev,
        type: value as ConditionFormType,
        unit: defaultUnit,
        // Count-like conditions do not support waste factor
        wasteFactor: value === 'count' || value === 'auto-count' ? '0' : prev.wasteFactor,
        // Reset type-specific fields when type changes
        includeHeight: false,
        height: '',
        depth: value === 'volume' ? prev.depth : '',
        lineThickness: value === 'linear' ? prev.lineThickness || '2' : '',
        searchImage: value === 'auto-count' ? prev.searchImage : '',
        searchImageId: value === 'auto-count' ? prev.searchImageId : '',
        // Reset sub-quantity fields when switching away from count
        subQuantityType: (value === 'count' || value === 'auto-count') ? prev.subQuantityType : '' as '' | 'linear' | 'area' | 'volume',
        subQuantityUnit: (value === 'count' || value === 'auto-count') ? prev.subQuantityUnit : '',
        subQuantityPerCount: (value === 'count' || value === 'auto-count') ? prev.subQuantityPerCount : '',
      };
      return newData;
    });
  };

  const effectiveUnit = formData.unit || getDefaultUnit(formData.type, formData.includeHeight);

  return (
    <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-background text-foreground border border-border shadow-2xl p-6 rounded-lg max-w-md mx-4 w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{editingCondition ? 'Edit Condition' : 'Create New Condition'}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              placeholder="e.g., Foundation Wall"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="type">Type *</Label>
              <Select value={formData.type} onValueChange={handleTypeChange}>
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="area">Area</SelectItem>
                  <SelectItem value="volume">Volume</SelectItem>
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="count">Count</SelectItem>
                  <SelectItem value="auto-count">Auto-Count</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="unit">Unit *</Label>
              <Select value={effectiveUnit} onValueChange={(value) => {
                handleInputChange('unit', value);
              }}>
                <SelectTrigger id="unit">
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  {formData.type === 'area' && (
                    <>
                      <SelectItem value="SF">SF (Square Feet)</SelectItem>
                      <SelectItem value="SY">SY (Square Yards)</SelectItem>
                      <SelectItem value="SM">SM (Square Meters)</SelectItem>
                    </>
                  )}
                  {formData.type === 'linear' && (
                    <>
                      {formData.includeHeight ? (
                        <>
                          <SelectItem value="SF">SF (Square Feet)</SelectItem>
                          <SelectItem value="SY">SY (Square Yards)</SelectItem>
                          <SelectItem value="SM">SM (Square Meters)</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="LF">LF (Linear Feet)</SelectItem>
                          <SelectItem value="LY">LY (Linear Yards)</SelectItem>
                          <SelectItem value="LM">LM (Linear Meters)</SelectItem>
                        </>
                      )}
                    </>
                  )}
                  {formData.type === 'volume' && (
                    <>
                      <SelectItem value="CY">CY (Cubic Yards)</SelectItem>
                      <SelectItem value="CF">CF (Cubic Feet)</SelectItem>
                      <SelectItem value="CM">CM (Cubic Meters)</SelectItem>
                    </>
                  )}
                  {(formData.type === 'count' || formData.type === 'auto-count') && (
                    <>
                      <SelectItem value="EA">EA (Each)</SelectItem>
                      <SelectItem value="PC">PC (Piece)</SelectItem>
                      <SelectItem value="LS">LS (Lump Sum)</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(formData.type === 'area' || formData.type === 'volume') && (
            <div>
              <Label htmlFor="includePerimeter" className="flex items-center space-x-2">
                <input
                  id="includePerimeter"
                  type="checkbox"
                  checked={formData.includePerimeter}
                  onChange={(e) => handleInputChange('includePerimeter', e.target.checked)}
                  className="rounded"
                />
                <span>Include perimeter measurement (LF)</span>
              </Label>
            </div>
          )}

          {formData.type === 'linear' && (
            <>
              <div>
                <Label htmlFor="includeHeight" className="flex items-center space-x-2">
                  <input
                    id="includeHeight"
                    type="checkbox"
                    checked={formData.includeHeight}
                    onChange={(e) => handleInputChange('includeHeight', e.target.checked)}
                    className="rounded"
                  />
                  <span>Include height for area calculation</span>
                </Label>
              </div>
              <div>
                <Label htmlFor="lineThickness">Line thickness (px)</Label>
                <Input
                  id="lineThickness"
                  type="number"
                  min={1}
                  max={8}
                  value={formData.lineThickness}
                  onChange={(e) => handleInputChange('lineThickness', e.target.value)}
                  className="mt-1 w-20"
                  placeholder="2"
                />
              </div>
            </>
          )}

          {formData.type === 'volume' && (
            <div>
              <Label htmlFor="depth">Depth</Label>
              <Input
                id="depth"
                type="text"
                value={formData.depth}
                onChange={(e) => handleInputChange('depth', e.target.value)}
                placeholder="e.g., 1.5 or 1'6&quot;"
                className={depthError ? 'border-red-500' : ''}
              />
              {depthError && (
                <p className="text-sm text-red-500 mt-1">{depthError}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Enter depth as decimal feet (1.5) or feet/inches (1'6&quot;)
              </p>
            </div>
          )}

          {formData.type === 'linear' && formData.includeHeight && (
            <div>
              <Label htmlFor="height">Height</Label>
              <Input
                id="height"
                type="text"
                value={formData.height}
                onChange={(e) => handleInputChange('height', e.target.value)}
                placeholder="e.g., 1.5 or 1'6&quot;"
                className={heightError ? 'border-red-500' : ''}
              />
              {heightError && (
                <p className="text-sm text-red-500 mt-1">{heightError}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Enter height as decimal feet (1.5) or feet/inches (1'6&quot;)
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {isCountLikeCondition(formData.type) ? (
              <div>
                <Label>Marker Shape</Label>
                <div className="flex gap-1 mt-2">
                  {(['circle', 'triangle', 'square', 'star', 'checkmark'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleInputChange('markerShape', s)}
                      title={s.charAt(0).toUpperCase() + s.slice(1)}
                      className={`p-1 rounded border-2 transition-colors ${
                        formData.markerShape === s
                          ? 'border-primary bg-primary/10'
                          : 'border-transparent hover:border-muted-foreground/30 bg-muted/50'
                      }`}
                    >
                      <svg width="22" height="22" viewBox="-12 -12 24 24" xmlns="http://www.w3.org/2000/svg">
                        {s === 'circle' && <circle cx="0" cy="0" r="9" fill={formData.color} />}
                        {s === 'square' && <rect x="-9" y="-9" width="18" height="18" fill={formData.color} />}
                        {s === 'triangle' && <polygon points="0,-10 10,5.5 -10,5.5" fill={formData.color} />}
                        {s === 'star' && (
                          <polygon
                            points="0,-9 2.35,-3.24 8.56,-2.78 3.80,1.24 5.29,7.28 0,4 -5.29,7.28 -3.80,1.24 -8.56,-2.78 -2.35,-3.24"
                            fill={formData.color}
                          />
                        )}
                        {s === 'checkmark' && (
                          <polyline
                            points="-8,0 -2.5,7 9,-7"
                            fill="none"
                            stroke={formData.color}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <Label htmlFor="wasteFactor">Waste Factor (%)</Label>
                <Input
                  id="wasteFactor"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={formData.wasteFactor}
                  onChange={(e) => handleInputChange('wasteFactor', e.target.value)}
                  placeholder="0"
                />
              </div>
            )}

            <div>
              <Label htmlFor="multiplier">
                Quantity Multiplier
              </Label>
              <Input
                id="multiplier"
                type="number"
                min="1"
                step="1"
                value={formData.multiplier}
                onChange={(e) => handleInputChange('multiplier', e.target.value)}
                placeholder="1 (no multiplier)"
                title="Multiplies the total measured quantity. Use when the same area/count repeats in N identical locations."
              />
              {formData.multiplier && parseInt(formData.multiplier, 10) > 1 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  ⚠ ×{formData.multiplier} multiplier active — quantities will be multiplied
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="color">Color</Label>
              <Input
                id="color"
                type="color"
                value={formData.color}
                onChange={(e) => handleInputChange('color', e.target.value)}
                className="h-10"
              />
            </div>
          </div>

          {folders.length > 0 && (
            <div>
              <Label htmlFor="folderId">Folder</Label>
              <Select
                value={formData.folderId ?? ''}
                onValueChange={(v) => handleInputChange('folderId', v === '__none__' ? null : v)}
              >
                <SelectTrigger id="folderId">
                  <SelectValue placeholder="None (uncategorized)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (uncategorized)</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="Describe the condition..."
              rows={3}
            />
          </div>

          {formData.type === 'auto-count' && (
            <>
              {formData.searchImage && (
                <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-2">
                  <p className="text-xs font-medium text-indigo-900 dark:text-indigo-200 mb-1.5">Searched symbol</p>
                  <img
                    src={getImageSrc(formData.searchImage)}
                    alt="Searched symbol"
                    className="max-w-full h-auto max-h-20 rounded border border-indigo-300 dark:border-indigo-700 bg-white"
                    style={{ imageRendering: 'crisp-edges' }}
                  />
                  <p className="text-xs text-indigo-600 dark:text-indigo-300 mt-1">Defined by selection on PDF. Re-run search to change.</p>
                </div>
              )}
              <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4">
                <div className="flex items-start space-x-2">
                  <div className="flex-shrink-0">
                    <div className="w-6 h-6 bg-indigo-100 dark:bg-indigo-900 rounded-full flex items-center justify-center">
                      <span className="text-indigo-600 dark:text-indigo-300 text-sm">🔍</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-indigo-900 dark:text-indigo-200 mb-1">Auto-Count Condition</h4>
                    <p className="text-sm text-indigo-700 dark:text-indigo-300 mb-2">
                      After creating this condition, you'll be able to draw a selection box around a symbol on the drawing to define what to count.
                    </p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-300">
                      The system will use AI to automatically find and count all similar symbols based on your selected scope.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <Label htmlFor="searchScope">Search Scope</Label>
                <Select 
                  value={formData.searchScope} 
                  onValueChange={(value) => handleInputChange('searchScope', value)}
                >
                  <SelectTrigger id="searchScope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current-page">Current Page</SelectItem>
                    <SelectItem value="entire-document">Entire Document</SelectItem>
                    <SelectItem value="entire-project">Entire Project</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Select where to search for matching symbols: current page only, all pages in the current document, or all pages in all documents.
                </p>
              </div>

              <div>
                <Label htmlFor="searchThreshold">Detection Confidence</Label>
                <Input
                  id="searchThreshold"
                  type="number"
                  min="0.1"
                  max="1.0"
                  step="0.1"
                  value={formData.searchThreshold}
                  onChange={(e) => handleInputChange('searchThreshold', e.target.value)}
                  placeholder="0.7"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  How confident the AI should be before counting a match (0.1 = very loose, 1.0 = very strict)
                </p>
              </div>
            </>
          )}

          {isCountLikeCondition(formData.type) && (
            <div className="space-y-3 border border-border rounded-lg p-3 bg-muted/30">
              <div>
                <Label className="text-sm font-medium">Quantity per Count</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Attach a fixed measurement to each count — e.g. 10 LF of trim per window.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="subQuantityType" className="text-xs">Type</Label>
                  <Select
                    value={formData.subQuantityType || '__none__'}
                    onValueChange={(v) => {
                      const sqType = v === '__none__' ? '' : v as 'linear' | 'area' | 'volume';
                      const defaultSqUnit = sqType === 'linear' ? 'LF' : sqType === 'area' ? 'SF' : sqType === 'volume' ? 'CY' : '';
                      setFormData(prev => ({ ...prev, subQuantityType: sqType as '' | 'linear' | 'area' | 'volume', subQuantityUnit: defaultSqUnit, subQuantityPerCount: prev.subQuantityPerCount }));
                    }}
                  >
                    <SelectTrigger id="subQuantityType" className="h-8 text-sm">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      <SelectItem value="linear">Linear</SelectItem>
                      <SelectItem value="area">Area</SelectItem>
                      <SelectItem value="volume">Volume</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {formData.subQuantityType && (
                  <div>
                    <Label htmlFor="subQuantityUnit" className="text-xs">Unit</Label>
                    <Select
                      value={formData.subQuantityUnit}
                      onValueChange={(v) => handleInputChange('subQuantityUnit', v)}
                    >
                      <SelectTrigger id="subQuantityUnit" className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {formData.subQuantityType === 'linear' && (
                          <>
                            <SelectItem value="LF">LF (Linear Feet)</SelectItem>
                            <SelectItem value="LY">LY (Linear Yards)</SelectItem>
                            <SelectItem value="LM">LM (Linear Meters)</SelectItem>
                          </>
                        )}
                        {formData.subQuantityType === 'area' && (
                          <>
                            <SelectItem value="SF">SF (Square Feet)</SelectItem>
                            <SelectItem value="SY">SY (Square Yards)</SelectItem>
                            <SelectItem value="SM">SM (Square Meters)</SelectItem>
                          </>
                        )}
                        {formData.subQuantityType === 'volume' && (
                          <>
                            <SelectItem value="CY">CY (Cubic Yards)</SelectItem>
                            <SelectItem value="CF">CF (Cubic Feet)</SelectItem>
                            <SelectItem value="CM">CM (Cubic Meters)</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {formData.subQuantityType && (
                <div>
                  <Label htmlFor="subQuantityPerCount" className="text-xs">
                    Value per count ({formData.subQuantityUnit})
                  </Label>
                  <Input
                    id="subQuantityPerCount"
                    type="number"
                    min="0"
                    step="any"
                    value={formData.subQuantityPerCount}
                    onChange={(e) => handleInputChange('subQuantityPerCount', e.target.value)}
                    placeholder="e.g., 10"
                    className="h-8 text-sm mt-1"
                  />
                  {formData.subQuantityPerCount && parseFloat(formData.subQuantityPerCount) > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Each marker adds {formData.subQuantityPerCount} {formData.subQuantityUnit} to the total.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="materialCost">
              Material Cost ({isCountLikeCondition(formData.type) && formData.subQuantityType && formData.subQuantityUnit
                ? `$/${formData.subQuantityUnit}`
                : formData.type === 'count' || formData.type === 'auto-count' ? '$/unit' : `$/${effectiveUnit}`})
            </Label>
            <Input
              id="materialCost"
              type="number"
              min="0"
              step="0.01"
              value={formData.materialCost || ''}
              onChange={(e) => {
                const value = e.target.value;
                handleInputChange('materialCost', value === '' ? '' : value);
              }}
              placeholder="0.00"
            />
          </div>

          <div>
            <Label htmlFor="equipmentCost">Equipment Cost ($)</Label>
            <Input
              id="equipmentCost"
              type="number"
              min="0"
              step="0.01"
              value={formData.equipmentCost || ''}
              onChange={(e) => {
                const value = e.target.value;
                handleInputChange('equipmentCost', value === '' ? '' : value);
              }}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Fixed equipment cost for this condition (e.g., crane rental, specialized tools)
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? (editingCondition ? 'Updating...' : 'Creating...') : (editingCondition ? 'Update Condition' : 'Create Condition')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
