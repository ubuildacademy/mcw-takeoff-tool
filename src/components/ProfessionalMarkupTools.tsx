import React, { useState, useCallback } from 'react';
import { Button } from './ui/button';
import { 
  Pencil, 
  Square, 
  Circle, 
  Type, 
  ArrowRight, 
  Highlighter,
  Eraser,
  Undo,
  Redo,
  Save,
  Download
} from 'lucide-react';

interface MarkupTool {
  id: string;
  name: string;
  icon: React.ReactNode;
  type: 'draw' | 'shape' | 'text' | 'arrow' | 'highlight' | 'erase' | 'action';
  active?: boolean;
}

interface ProfessionalMarkupToolsProps {
  onToolSelect: (tool: MarkupTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onExport: () => void;
  canUndo: boolean;
  canRedo: boolean;
  activeTool?: string;
}

const ProfessionalMarkupTools: React.FC<ProfessionalMarkupToolsProps> = ({
  onToolSelect,
  onUndo,
  onRedo,
  onSave,
  onExport,
  canUndo,
  canRedo,
  activeTool
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#ff0000');
  const [lineWidth, setLineWidth] = useState(2);

  const tools: MarkupTool[] = [
    {
      id: 'pencil',
      name: 'Freehand Draw',
      icon: <Pencil className="w-4 h-4" />,
      type: 'draw'
    },
    {
      id: 'rectangle',
      name: 'Rectangle',
      icon: <Square className="w-4 h-4" />,
      type: 'shape'
    },
    {
      id: 'circle',
      name: 'Circle',
      icon: <Circle className="w-4 h-4" />,
      type: 'shape'
    },
    {
      id: 'text',
      name: 'Text Annotation',
      icon: <Type className="w-4 h-4" />,
      type: 'text'
    },
    {
      id: 'arrow',
      name: 'Arrow',
      icon: <ArrowRight className="w-4 h-4" />,
      type: 'arrow'
    },
    {
      id: 'highlight',
      name: 'Highlighter',
      icon: <Highlighter className="w-4 h-4" />,
      type: 'highlight'
    },
    {
      id: 'eraser',
      name: 'Eraser',
      icon: <Eraser className="w-4 h-4" />,
      type: 'erase'
    }
  ];

  const actionTools: MarkupTool[] = [
    {
      id: 'undo',
      name: 'Undo',
      icon: <Undo className="w-4 h-4" />,
      type: 'action'
    },
    {
      id: 'redo',
      name: 'Redo',
      icon: <Redo className="w-4 h-4" />,
      type: 'action'
    },
    {
      id: 'save',
      name: 'Save',
      icon: <Save className="w-4 h-4" />,
      type: 'action'
    },
    {
      id: 'export',
      name: 'Export',
      icon: <Download className="w-4 h-4" />,
      type: 'action'
    }
  ];

  const colors = [
    '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
    '#ff8000', '#8000ff', '#0080ff', '#ff0080', '#80ff00', '#00ff80',
    '#000000', '#808080', '#ffffff'
  ];

  const handleToolClick = useCallback((tool: MarkupTool) => {
    if (tool.type === 'action') {
      switch (tool.id) {
        case 'undo':
          onUndo();
          break;
        case 'redo':
          onRedo();
          break;
        case 'save':
          onSave();
          break;
        case 'export':
          onExport();
          break;
      }
    } else {
      onToolSelect(tool);
    }
  }, [onToolSelect, onUndo, onRedo, onSave, onExport]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 space-y-4">
      {/* Drawing Tools */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Drawing Tools</h3>
        <div className="grid grid-cols-4 gap-2">
          {tools.map((tool) => (
            <Button
              key={tool.id}
              variant={activeTool === tool.id ? "default" : "outline"}
              size="sm"
              onClick={() => handleToolClick(tool)}
              className="flex flex-col items-center gap-1 h-auto py-2"
              title={tool.name}
            >
              {tool.icon}
              <span className="text-xs">{tool.name}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Color Picker */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Colors</h3>
        <div className="flex gap-2">
          <div className="flex gap-1">
            {colors.map((color) => (
              <button
                key={color}
                className={`w-6 h-6 rounded border-2 ${
                  selectedColor === color ? 'border-gray-800' : 'border-gray-300'
                }`}
                style={{ backgroundColor: color }}
                onClick={() => setSelectedColor(color)}
                title={color}
              />
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowColorPicker(!showColorPicker)}
          >
            Custom
          </Button>
        </div>
        {showColorPicker && (
          <div className="mt-2">
            <input
              type="color"
              value={selectedColor}
              onChange={(e) => setSelectedColor(e.target.value)}
              className="w-full h-8 rounded border"
            />
          </div>
        )}
      </div>

      {/* Line Width */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Line Width</h3>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((width) => (
            <button
              key={width}
              className={`w-8 h-8 rounded border flex items-center justify-center ${
                lineWidth === width ? 'bg-blue-100 border-blue-500' : 'border-gray-300'
              }`}
              onClick={() => setLineWidth(width)}
            >
              <div
                className="bg-gray-600 rounded-full"
                style={{ width: width, height: width }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Action Tools */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Actions</h3>
        <div className="grid grid-cols-2 gap-2">
          {actionTools.map((tool) => (
            <Button
              key={tool.id}
              variant="outline"
              size="sm"
              onClick={() => handleToolClick(tool)}
              disabled={
                (tool.id === 'undo' && !canUndo) ||
                (tool.id === 'redo' && !canRedo)
              }
              className="flex items-center gap-2"
            >
              {tool.icon}
              {tool.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Tool Settings Display */}
      <div className="pt-2 border-t border-gray-200">
        <div className="text-xs text-gray-500 space-y-1">
          <div>Color: <span className="font-mono">{selectedColor}</span></div>
          <div>Width: {lineWidth}px</div>
          <div>Tool: {activeTool || 'None'}</div>
        </div>
      </div>
    </div>
  );
};

export default ProfessionalMarkupTools;
