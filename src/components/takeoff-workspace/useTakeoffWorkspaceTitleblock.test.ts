import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTakeoffWorkspaceTitleblock } from './useTakeoffWorkspaceTitleblock';

vi.mock('../../services/apiService', () => ({
  titleblockService: {
    extractTitleblock: vi.fn().mockResolvedValue(undefined),
  },
}));

const defaultOptions = {
  projectId: 'project-1' as string | undefined,
  documents: [],
  projectFiles: [],
  loadProjectDocuments: vi.fn().mockResolvedValue(undefined),
  handlePageSelect: vi.fn(),
};

describe('useTakeoffWorkspaceTitleblock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns expected shape and initial state', () => {
    const { result } = renderHook(() => useTakeoffWorkspaceTitleblock(defaultOptions));

    expect(result.current.titleblockSelectionMode).toBeNull();
    expect(result.current.titleblockSelectionContext).toBeNull();
    expect(result.current.titleblockExtractionStatus).toBeNull();
    expect(typeof result.current.setTitleblockSelectionMode).toBe('function');
    expect(typeof result.current.handleTitleblockSelectionComplete).toBe('function');
    expect(typeof result.current.handleExtractTitleblockForDocument).toBe('function');
    expect(typeof result.current.handleBulkExtractTitleblock).toBe('function');
  });

  it('setTitleblockSelectionMode updates mode', () => {
    const { result } = renderHook(() => useTakeoffWorkspaceTitleblock(defaultOptions));

    act(() => {
      result.current.setTitleblockSelectionMode('sheetNumber');
    });

    expect(result.current.titleblockSelectionMode).toBe('sheetNumber');

    act(() => {
      result.current.setTitleblockSelectionMode(null);
    });

    expect(result.current.titleblockSelectionMode).toBeNull();
  });
});
