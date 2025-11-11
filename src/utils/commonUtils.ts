// Common utility functions used across components

/**
 * Generate a random color from a predefined palette
 */
export const generateRandomColor = (): string => {
  const colors = [
    '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57',
    '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3', '#ff9f43',
    '#10ac84', '#ee5a24', '#0984e3', '#6c5ce7', '#a29bfe',
    '#fd79a8', '#fdcb6e', '#e17055', '#74b9ff', '#00b894'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
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
export const debounce = <T extends (...args: any[]) => any>(
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
export const throttle = <T extends (...args: any[]) => any>(
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
export const safeJsonStringify = (obj: any, fallback: string = '{}'): string => {
  try {
    return JSON.stringify(obj);
  } catch {
    return fallback;
  }
};

/**
 * Check if a value is empty (null, undefined, empty string, empty array, empty object)
 */
export const isEmpty = (value: any): boolean => {
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
  if (obj instanceof Date) return new Date(obj.getTime()) as any;
  if (obj instanceof Array) return obj.map(item => deepClone(item)) as any;
  if (typeof obj === 'object') {
    const clonedObj = {} as any;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
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
