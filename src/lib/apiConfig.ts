/**
 * Centralized API configuration
 * 
 * This ensures consistent API URL resolution across the entire application.
 * It checks both build-time and runtime environment to handle edge cases.
 */

/**
 * Get the API base URL, with smart fallbacks
 */
export function getApiBaseUrl(): string {
  // Priority 1: Explicitly set environment variable (always wins)
  const explicitUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (explicitUrl) {
    return explicitUrl;
  }

  // Priority 2: Runtime check - if we're not on localhost, we're in production
  // This handles cases where PROD might not be set correctly during build
  if (typeof window !== 'undefined') {
    const isLocalhost = window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1' ||
                        window.location.hostname === '';
    
    if (!isLocalhost) {
      // We're in production - use relative URL that will be proxied by vercel.json
      return '/api';
    }
  }

  // Priority 3: Build-time check (fallback)
  if (import.meta.env.PROD) {
    return '/api';
  }

  // Priority 4: Development fallback
  return 'http://localhost:4000/api';
}

/**
 * Get the base server URL (for Socket.IO, which doesn't use /api path)
 */
export function getServerBaseUrl(): string {
  const apiUrl = getApiBaseUrl();
  
  // If it's an explicit URL, remove /api suffix
  if (apiUrl.startsWith('http')) {
    return apiUrl.replace(/\/api$/, '');
  }
  
  // If it's relative (/api), use same origin
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  
  // Development fallback
  return 'http://localhost:4000';
}

