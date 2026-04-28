import '@testing-library/jest-dom/vitest';

// Tests run in CI without real VITE_* credentials. Mock Supabase so modules that
// import `src/lib/supabase.ts` don't throw during evaluation.
import { vi } from 'vitest';

vi.mock('../lib/supabase', () => {
  const auth = {
    getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    refreshSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    setSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
  };

  return {
    supabase: {
      auth,
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn() })) })) })),
    },
    authHelpers: {
      getCurrentUser: vi.fn(async () => null),
      getCurrentSession: vi.fn(async () => null),
      getValidSession: vi.fn(async () => null),
      getUserMetadata: vi.fn(async () => null),
      updateUserMetadata: vi.fn(async () => ({ data: null, error: null })),
      isAdmin: vi.fn(async () => false),
    },
  };
});
