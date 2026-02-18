// Common utility functions used across components

/**
 * Predefined palette of visually distinct colors
 */
const COLOR_PALETTE = [
  '#e63946', // Red
  '#2a9d8f', // Teal
  '#e9c46a', // Yellow
  '#264653', // Dark blue
  '#f4a261', // Orange
  '#8338ec', // Purple
  '#06d6a0', // Mint green
  '#ef476f', // Pink
  '#118ab2', // Blue
  '#073b4c', // Navy
  '#ffd166', // Gold
  '#06aed5', // Cyan
  '#9b5de5', // Violet
  '#00f5d4', // Aqua
  '#f15bb5', // Magenta
  '#fee440', // Bright yellow
  '#00bbf9', // Sky blue
  '#9b2335', // Burgundy
  '#4cc9f0', // Light blue
  '#7209b7', // Deep purple
];

/**
 * Convert hex color to HSL
 */
const hexToHsl = (hex: string): { h: number; s: number; l: number } => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
};

/**
 * Calculate the minimum hue distance from a given hue to any existing hue
 * Hue is circular (0-360), so we need to handle wraparound
 */
const getMinHueDistance = (hue: number, existingHues: number[]): number => {
  if (existingHues.length === 0) return 180; // Maximum possible distance
  
  let minDistance = 360;
  for (const existingHue of existingHues) {
    // Calculate circular distance
    const distance = Math.min(
      Math.abs(hue - existingHue),
      360 - Math.abs(hue - existingHue)
    );
    minDistance = Math.min(minDistance, distance);
  }
  return minDistance;
};

/**
 * Generate a random color from a predefined palette (legacy function for backward compatibility)
 */
export const generateRandomColor = (): string => {
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
};

/**
 * Generate a color that is maximally different from existing colors
 * Uses HSL color space to find the most visually distinct color
 */
export const generateDistinctColor = (existingColors: string[]): string => {
  if (existingColors.length === 0) {
    // No existing colors, return first from palette
    return COLOR_PALETTE[0];
  }

  // Convert existing colors to HSL and extract hues
  const existingHues = existingColors
    .filter(c => c && c.startsWith('#') && c.length >= 7)
    .map(color => hexToHsl(color).h);

  // Find the color from the palette that has the maximum minimum distance from existing hues
  let bestColor = COLOR_PALETTE[0];
  let bestDistance = -1;

  for (const color of COLOR_PALETTE) {
    const hsl = hexToHsl(color);
    const minDistance = getMinHueDistance(hsl.h, existingHues);
    
    if (minDistance > bestDistance) {
      bestDistance = minDistance;
      bestColor = color;
    }
  }

  // If best distance is still too small (colors are getting crowded), 
  // generate a color in the largest hue gap
  if (bestDistance < 20 && existingHues.length > 0) {
    // Sort hues
    const sortedHues = [...existingHues].sort((a, b) => a - b);
    
    // Find the largest gap
    let largestGap = 0;
    let gapStart = 0;
    
    for (let i = 0; i < sortedHues.length; i++) {
      const nextIndex = (i + 1) % sortedHues.length;
      let gap;
      if (nextIndex === 0) {
        // Wraparound gap
        gap = (360 - sortedHues[i]) + sortedHues[0];
      } else {
        gap = sortedHues[nextIndex] - sortedHues[i];
      }
      
      if (gap > largestGap) {
        largestGap = gap;
        gapStart = sortedHues[i];
      }
    }
    
    // Generate a color in the middle of the largest gap
    const newHue = (gapStart + largestGap / 2) % 360;
    // Use high saturation and medium lightness for visibility
    return hslToHex(newHue, 70, 50);
  }

  return bestColor;
};

/**
 * Convert HSL to hex color
 */
const hslToHex = (h: number, s: number, l: number): string => {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Get default unit for a measurement type
 */
export const getDefaultUnit = (type: 'area' | 'volume' | 'linear' | 'count'): string => {
  switch (type) {
    case 'area': return 'SF';
    case 'volume': return 'CY';
    case 'linear': return 'LF';
    case 'count': return 'EA';
    default: return 'SF';
  }
};

/**
 * Calculate distance between two points
 */
export const calculateDistance = (point1: { x: number; y: number }, point2: { x: number; y: number }): number => {
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Generate a unique ID based on timestamp
 */
export const generateId = (): string => {
  return Date.now().toString();
};

/**
 * Format date for display
 */
export const formatDate = (date: string | Date): string => {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

/**
 * Format date and time for display
 */
export const formatDateTime = (date: string | Date): string => {
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Debounce function to limit function calls
 */
export const debounce = <T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

/**
 * Throttle function to limit function calls
 */
export const throttle = <T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => void) => {
  let inThrottle: boolean;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

/**
 * Safe JSON parse with fallback
 */
export const safeJsonParse = <T>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};

/**
 * Safe JSON stringify with fallback
 */
export const safeJsonStringify = (obj: unknown, fallback: string = '{}'): string => {
  try {
    return JSON.stringify(obj);
  } catch {
    return fallback;
  }
};

/**
 * Extract a human-readable error message from unknown error values.
 * Handles Error instances, objects with .message or .error, and primitives.
 */
export const extractErrorMessage = (error: unknown, fallback = 'Unknown error'): string => {
  if (error instanceof Error) {
    const msg = error.message || String(error);
    if (msg !== '[object Object]' && !msg.includes('[object Object]')) return msg;
  }
  if (error && typeof error === 'object') {
    try {
      const err = error as Record<string, unknown>;
      const msg = typeof err.message === 'string' ? err.message : null;
      const errProp = typeof err.error === 'string' ? err.error : null;
      return msg ?? errProp ?? JSON.stringify(error) ?? fallback;
    } catch {
      return fallback;
    }
  }
  return error != null ? String(error) : fallback;
};

/**
 * Check if a value is empty (null, undefined, empty string, empty array, empty object)
 */
export const isEmpty = (value: unknown): boolean => {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
};

/**
 * Deep clone an object
 */
export const deepClone = <T>(obj: T): T => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as T;
  if (obj instanceof Array) return obj.map(item => deepClone(item)) as T;
  if (typeof obj === 'object') {
    const clonedObj: Record<string, unknown> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        clonedObj[key] = deepClone((obj as Record<string, unknown>)[key]);
      }
    }
    return clonedObj as T;
  }
  return obj;
};

/**
 * Parse feet and inches format (e.g., "1'2"", "1'2½"", "2'", "1'") to decimal feet
 * Also handles decimal feet format (e.g., "1.5", "1")
 * Very accepting - handles: "1", "1'", "1.5", "1'6"", "2'", etc.
 */
export const parseDepthInput = (input: string): number | null => {
  if (!input || input.trim() === '') return null;
  
  const trimmedInput = input.trim();
  
  // First, try to handle simple decimal format (e.g., "1", "1.5", "2.25")
  // This regex matches: digits, optional decimal point, more digits
  if (/^\d+(\.\d+)?$/.test(trimmedInput)) {
    const decimalValue = parseFloat(trimmedInput);
    return isNaN(decimalValue) || decimalValue <= 0 ? null : decimalValue;
  }
  
  // Handle feet and inches format with various patterns:
  // Pattern 1: "1'" - just feet with apostrophe
  if (/^\d+'$/.test(trimmedInput)) {
    const feet = parseInt(trimmedInput.replace("'", ''), 10);
    return isNaN(feet) || feet <= 0 ? null : feet;
  }
  
  // Pattern 2: "1'6"" - feet and inches
  // Pattern 3: "1'6½"" - feet and inches with half
  // Pattern 4: "6"" - just inches
  const feetInchesMatch = trimmedInput.match(/^(?:(\d+)')?(?:(\d+(?:\.\d+)?)(?:½)?")?$/);
  if (feetInchesMatch) {
    const feetStr = feetInchesMatch[1];
    const inchesStr = feetInchesMatch[2];
    
    const feet = feetStr ? parseInt(feetStr, 10) : 0;
    let inches = 0;
    
    if (inchesStr) {
      inches = parseFloat(inchesStr);
      // Handle ½ inch notation
      if (trimmedInput.includes('½')) {
        inches += 0.5;
      }
    }
    
    // Convert to decimal feet
    const totalFeet = feet + (inches / 12);
    return totalFeet > 0 ? totalFeet : null;
  }
  
  // Last resort: try to parse as a plain number (handles edge cases like "1.0")
  const plainNumber = parseFloat(trimmedInput);
  if (!isNaN(plainNumber) && plainNumber > 0) {
    return plainNumber;
  }
  
  return null;
};

/**
 * Format decimal feet to feet and inches format (e.g., 1.5 -> "1'6"")
 */
export const formatDepthOutput = (decimalFeet: number): string => {
  const feet = Math.floor(decimalFeet);
  const inches = Math.round((decimalFeet - feet) * 12);
  
  if (feet === 0) {
    return `${inches}"`;
  } else if (inches === 0) {
    return `${feet}'`;
  } else {
    return `${feet}'${inches}"`;
  }
};

/**
 * Format a timestamp as relative time (e.g., "1 minute ago", "2 hours ago")
 */
export const formatRelativeTime = (date: string | Date): string => {
  const now = new Date();
  const targetDate = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - targetDate.getTime()) / 1000);
  
  if (diffInSeconds < 60) {
    return 'Just now';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  } else if (diffInSeconds < 2592000) {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  } else {
    return formatDate(targetDate);
  }
};
