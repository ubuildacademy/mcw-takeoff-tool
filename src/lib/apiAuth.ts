/**
 * Shared auth helpers for API requests (fetch, etc.)
 * Use apiClient (apiService) for axios-based calls; it already attaches auth via interceptors.
 */

/**
 * Returns headers object including Bearer token when user is signed in.
 * Use for raw fetch() calls to authenticated API routes.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  try {
    const { supabase } = await import('./supabase');
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch {
    // No session – caller may still proceed (e.g. public routes)
  }
  return headers;
}
