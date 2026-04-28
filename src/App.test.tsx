import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Prevent App from hitting real Supabase during tests
vi.mock('./store/slices/projectSlice', () => ({
  useProjectStore: (selector: any) => selector({ loadInitialData: vi.fn(async () => {}) }),
}));

import App from './App';

describe('App routing', () => {
  it('renders a friendly 404 page for unknown routes', async () => {
    window.history.pushState({}, '', '/does-not-exist');
    render(<App />);
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to app' })).toHaveAttribute('href', '/app');
  });
});

