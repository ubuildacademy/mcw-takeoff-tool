import React from 'react';

export interface SearchResultsListProps {
  results: string[];
}

/**
 * Renders the "Search Results" list below the PDF viewer in TakeoffWorkspace.
 * Displays mock or in-document search hits as clickable items.
 */
export function SearchResultsList({ results }: SearchResultsListProps) {
  if (results.length === 0) return null;

  return (
    <div className="border-t bg-muted/30 p-3">
      <h3 className="font-medium mb-2">Search Results ({results.length})</h3>
      <div className="space-y-1">
        {results.map((result, index) => (
          <div
            key={index}
            className="text-sm p-2 bg-background rounded border cursor-pointer hover:bg-accent"
          >
            {result}
          </div>
        ))}
      </div>
    </div>
  );
}
