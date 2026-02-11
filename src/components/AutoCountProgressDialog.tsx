import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Search, X, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface CompletionResult {
  success: boolean;
  matchesFound: number;
  measurementsCreated: number;
  message?: string; // Custom message for special cases
}

interface AutoCountProgressDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCancel: () => void;
  progress: {
    current: number;
    total: number;
    currentPage?: number;
    currentDocument?: string;
  } | null;
  conditionName: string;
  searchScope: 'current-page' | 'entire-document' | 'entire-project';
  isCancelling?: boolean;
  completionResult?: CompletionResult | null;
}

export function AutoCountProgressDialog({
  isOpen,
  onClose,
  onCancel,
  progress,
  conditionName,
  searchScope,
  isCancelling = false,
  completionResult = null
}: AutoCountProgressDialogProps) {
  const progressPercent = progress 
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  const scopeLabels = {
    'current-page': 'Current Page',
    'entire-document': 'Entire Document',
    'entire-project': 'Entire Project'
  };

  const isComplete = completionResult !== null;
  const isSearching = progress && progress.current < progress.total && !isComplete;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isCancelling && !isSearching && onClose()}>
      <DialogContent className="max-w-2xl" aria-describedby="autocount-dialog-description" onInteractOutside={(e) => {
        // Prevent closing during processing
        if (isSearching) {
          e.preventDefault();
        }
      }}>
        <DialogDescription id="autocount-dialog-description" className="sr-only">
          Progress for automatic symbol search and count.
        </DialogDescription>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isComplete ? (
              completionResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-yellow-600" />
              )
            ) : (
              <Search className="w-5 h-5 text-indigo-600" />
            )}
            {isComplete ? 'Auto-Count Complete' : 'Auto-Count in Progress'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Condition Info */}
          <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
            <h3 className="font-medium text-indigo-900 mb-1">{conditionName}</h3>
            <div className="flex items-center gap-4 text-sm text-indigo-700">
              <span>Scope: {scopeLabels[searchScope]}</span>
              {progress && (
                <>
                  <span>•</span>
                  <span>{progress.total} {progress.total === 1 ? 'page' : 'pages'} to search</span>
                </>
              )}
            </div>
          </div>

          {/* Progress */}
          {progress && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Search Progress</span>
                <span className="text-sm text-gray-600">{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="w-full h-2" />
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Clock className="w-4 h-4" />
                  <span>
                    Processing page {progress.current} of {progress.total}
                    {progress.currentDocument && ` in "${progress.currentDocument}"`}
                  </span>
                </div>
                
                {progress.currentPage && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span>Current page: {progress.currentPage}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cancelling State */}
          {isCancelling && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center gap-2 text-yellow-800">
                <Clock className="w-4 h-4 animate-spin" />
                <span className="text-sm font-medium">Cancelling search...</span>
              </div>
            </div>
          )}

          {/* Completion Result */}
          {isComplete && (
            <div className={`p-4 rounded-lg border ${
              completionResult.success 
                ? 'bg-green-50 border-green-200' 
                : 'bg-yellow-50 border-yellow-200'
            }`}>
              {completionResult.success ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-green-800">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">Search completed successfully!</span>
                  </div>
                  <p className="text-green-700 text-sm">
                    Found <span className="font-semibold">{completionResult.matchesFound}</span> matching items and created <span className="font-semibold">{completionResult.measurementsCreated}</span> count measurements.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-yellow-800">
                    <AlertCircle className="w-5 h-5" />
                    <span className="font-medium">No matches found</span>
                  </div>
                  {completionResult.message && (
                    <p className="text-yellow-700 text-sm whitespace-pre-line">
                      {completionResult.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            {isSearching && !isCancelling && (
              <Button
                variant="outline"
                onClick={onCancel}
                className="flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                Cancel Search
              </Button>
            )}
            {(isComplete || isCancelling || !isSearching) && (
              <Button
                onClick={onClose}
                disabled={isCancelling}
              >
                {isCancelling ? 'Cancelling...' : 'OK'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
