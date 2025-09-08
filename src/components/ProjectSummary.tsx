import React from 'react';
import { useTakeoffStore } from '../store/useTakeoffStore';
import { Badge } from './ui/badge';
import { Calculator, FileText, TrendingUp } from 'lucide-react';

interface ProjectSummaryProps {
  projectId: string;
}

export function ProjectSummary({ projectId }: ProjectSummaryProps) {
  const { getProjectTakeoffSummary, getCurrentProject } = useTakeoffStore();
  
  const currentProject = getCurrentProject();
  const summary = getProjectTakeoffSummary(projectId);
  
  if (!currentProject) return null;
  
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-semibold text-gray-900">Project Summary</h3>
      </div>
      
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="text-center p-3 bg-blue-50 rounded-lg">
          <div className="text-2xl font-bold text-blue-600">{summary.totalMeasurements}</div>
          <div className="text-sm text-blue-700">Total Takeoffs</div>
        </div>
        
        <div className="text-center p-3 bg-green-50 rounded-lg">
          <div className="text-2xl font-bold text-green-600">
            {summary.totalValue.toFixed(2)}
          </div>
          <div className="text-sm text-green-700">Total Value</div>
        </div>
      </div>
      
      <div className="space-y-3">
        <h4 className="font-medium text-gray-700 flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          By Condition
        </h4>
        
        {Object.entries(summary.byCondition).map(([conditionId, data]) => (
          <div key={conditionId} className="flex items-center justify-between p-2 bg-gray-50 rounded">
            <span className="text-sm font-medium text-gray-700">
              {data.count} items
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">
                {data.value.toFixed(2)} {data.unit}
              </span>
              <Badge variant="outline" className="text-xs">
                {data.unit}
              </Badge>
            </div>
          </div>
        ))}
        
        {Object.keys(summary.byCondition).length === 0 && (
          <div className="text-center py-4 text-gray-500">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No takeoffs yet</p>
            <p className="text-xs">Select a condition and start drawing</p>
          </div>
        )}
      </div>
    </div>
  );
}
