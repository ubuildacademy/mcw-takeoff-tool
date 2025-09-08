import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { 
  FileText, 
  Search, 
  Plus, 
  Upload, 
  Download,
  Trash2,
  Eye,
  EyeOff,
  MoreVertical
} from 'lucide-react';
import { fileService } from '../services/apiService';

interface Sheet {
  id: string;
  name: string;
  pageNumber: number;
  thumbnail?: string;
  isVisible: boolean;
  hasTakeoffs: boolean;
  takeoffCount: number;
}

interface SheetSidebarProps {
  projectId: string;
  onSheetSelect: (sheet: Sheet) => void;
  selectedSheet?: Sheet | null;
}

export function SheetSidebar({ projectId, onSheetSelect, selectedSheet }: SheetSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProjectSheets() {
      if (!projectId) return;
      
      try {
        setLoading(true);
        
        // Get project files and convert them to sheets
        const filesRes = await fileService.getProjectFiles(projectId);
        const files = filesRes.files || [];
        
        // Convert PDF files to sheets
        const pdfSheets: Sheet[] = files
          .filter((file: any) => file.mimetype === 'application/pdf')
          .map((file: any, index: number) => ({
            id: file.id,
            name: file.originalName.replace('.pdf', ''),
            pageNumber: index + 1,
            isVisible: true,
            hasTakeoffs: false, // Takeoff tracking will be implemented when needed
            takeoffCount: 0
          }));
        
        setSheets(pdfSheets);
        
      } catch (error) {
        console.error('Error loading project sheets:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadProjectSheets();
  }, [projectId]);

  const filteredSheets = sheets.filter(sheet =>
    sheet.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSheetClick = (sheet: Sheet) => {
    onSheetSelect(sheet);
  };

  const toggleSheetVisibility = (sheetId: string) => {
    setSheets(prev => prev.map(sheet => 
      sheet.id === sheetId 
        ? { ...sheet, isVisible: !sheet.isVisible }
        : sheet
    ));
  };

  const handleDeleteSheet = async (sheetId: string) => {
    try {
      // Call the backend API to delete the file
      await fileService.deletePDF(sheetId);
      
      // Only remove from local state after successful deletion
      setSheets(prev => prev.filter(sheet => sheet.id !== sheetId));
      
      console.log('✅ Sheet deleted successfully:', sheetId);
    } catch (error) {
      console.error('❌ Error deleting sheet:', error);
      // You could add a toast notification here to inform the user
      alert('Failed to delete sheet. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="w-80 bg-white border-l flex flex-col">
        <div className="p-4 border-b">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white border-l flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Project Sheets</h2>
          <Button size="sm" variant="outline">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        
        <Input
          placeholder="Search sheets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="mb-4"
        />

        {/* View Mode Toggle */}
        <div className="flex border rounded-lg p-1">
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            className="flex-1"
          >
            List
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('grid')}
            className="flex-1"
          >
            Grid
          </Button>
        </div>
      </div>

      {/* Sheets List */}
      <div className="flex-1 overflow-y-auto">
        {filteredSheets.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No sheets found</p>
            <p className="text-sm">Upload PDF files to see them here</p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {filteredSheets.map((sheet) => (
              <div
                key={sheet.id}
                className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedSheet?.id === sheet.id 
                    ? 'border-primary bg-primary/5' 
                    : 'hover:bg-accent/50'
                }`}
                onClick={() => handleSheetClick(sheet)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{sheet.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSheetVisibility(sheet.id);
                      }}
                      className="h-6 w-6 p-0"
                    >
                      {sheet.isVisible ? (
                        <Eye className="w-3 h-3" />
                      ) : (
                        <EyeOff className="w-3 h-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSheet(sheet.id);
                      }}
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-xs">
                    Page {sheet.pageNumber}
                  </Badge>
                  {sheet.hasTakeoffs && (
                    <Badge variant="secondary" className="text-xs">
                      {sheet.takeoffCount} takeoffs
                    </Badge>
                  )}
                  {!sheet.hasTakeoffs && (
                    <span className="text-xs">No takeoffs yet</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t bg-muted/30">
        <div className="text-center text-sm text-muted-foreground">
          {sheets.length} sheet{sheets.length !== 1 ? 's' : ''} total
        </div>
      </div>
    </div>
  );
}
