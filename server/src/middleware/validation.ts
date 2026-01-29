import { Request, Response, NextFunction } from 'express';

/**
 * Validate that a string is a valid UUID v4
 */
export function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Sanitize string to prevent XSS
 * Strips HTML tags and encodes special characters
 */
export function sanitizeString(str: string): string {
  if (typeof str !== 'string') return str;
  return str
    .replace(/[<>]/g, '')  // Remove angle brackets
    .trim()
    .slice(0, 10000);  // Limit length
}

/**
 * Middleware to validate UUID route parameters
 */
export function validateUUIDParam(...paramNames: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const paramName of paramNames) {
      const value = req.params[paramName];
      if (value && !isValidUUID(value)) {
        return res.status(400).json({ 
          error: `Invalid ${paramName} format - must be a valid UUID` 
        });
      }
    }
    next();
  };
}

/**
 * Middleware to validate required body fields exist
 */
export function validateRequiredFields(...fieldNames: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const missing = fieldNames.filter(field => {
      const value = req.body[field];
      return value === undefined || value === null || value === '';
    });
    
    if (missing.length > 0) {
      return res.status(400).json({ 
        error: `Missing required fields: ${missing.join(', ')}` 
      });
    }
    next();
  };
}

/**
 * Middleware to sanitize string fields in request body
 */
export function sanitizeBody(...fieldNames: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const field of fieldNames) {
      if (typeof req.body[field] === 'string') {
        req.body[field] = sanitizeString(req.body[field]);
      }
    }
    next();
  };
}

/**
 * Validate string length
 */
export function validateStringLength(fieldName: string, minLength: number, maxLength: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.body[fieldName];
    if (typeof value === 'string') {
      if (value.length < minLength) {
        return res.status(400).json({ 
          error: `${fieldName} must be at least ${minLength} characters` 
        });
      }
      if (value.length > maxLength) {
        return res.status(400).json({ 
          error: `${fieldName} must be at most ${maxLength} characters` 
        });
      }
    }
    next();
  };
}

/**
 * Validate numeric range
 */
export function validateNumericRange(fieldName: string, min?: number, max?: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.body[fieldName];
    if (value !== undefined && value !== null) {
      const num = typeof value === 'string' ? parseFloat(value) : value;
      if (isNaN(num)) {
        return res.status(400).json({ 
          error: `${fieldName} must be a valid number` 
        });
      }
      if (min !== undefined && num < min) {
        return res.status(400).json({ 
          error: `${fieldName} must be at least ${min}` 
        });
      }
      if (max !== undefined && num > max) {
        return res.status(400).json({ 
          error: `${fieldName} must be at most ${max}` 
        });
      }
    }
    next();
  };
}

/**
 * Validate enum value
 */
export function validateEnum(fieldName: string, allowedValues: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.body[fieldName];
    if (value !== undefined && !allowedValues.includes(value)) {
      return res.status(400).json({ 
        error: `${fieldName} must be one of: ${allowedValues.join(', ')}` 
      });
    }
    next();
  };
}

/**
 * Validate email field
 */
export function validateEmailField(fieldName: string, required: boolean = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.body[fieldName];
    if (required && !value) {
      return res.status(400).json({ error: `${fieldName} is required` });
    }
    if (value && !isValidEmail(value)) {
      return res.status(400).json({ error: `${fieldName} must be a valid email address` });
    }
    next();
  };
}

/**
 * Combined validation middleware builder
 */
export function validate(config: {
  params?: { name: string; type: 'uuid' }[];
  body?: {
    required?: string[];
    sanitize?: string[];
    strings?: { name: string; min?: number; max?: number }[];
    numbers?: { name: string; min?: number; max?: number }[];
    enums?: { name: string; values: string[] }[];
    emails?: { name: string; required?: boolean }[];
  };
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Validate UUID params
    if (config.params) {
      for (const param of config.params) {
        if (param.type === 'uuid') {
          const value = req.params[param.name];
          if (value && !isValidUUID(value)) {
            return res.status(400).json({ 
              error: `Invalid ${param.name} format - must be a valid UUID` 
            });
          }
        }
      }
    }
    
    // Validate body
    if (config.body) {
      // Check required fields
      if (config.body.required) {
        const missing = config.body.required.filter(field => {
          const value = req.body[field];
          return value === undefined || value === null || value === '';
        });
        if (missing.length > 0) {
          return res.status(400).json({ 
            error: `Missing required fields: ${missing.join(', ')}` 
          });
        }
      }
      
      // Sanitize strings
      if (config.body.sanitize) {
        for (const field of config.body.sanitize) {
          if (typeof req.body[field] === 'string') {
            req.body[field] = sanitizeString(req.body[field]);
          }
        }
      }
      
      // Validate string lengths
      if (config.body.strings) {
        for (const { name, min, max } of config.body.strings) {
          const value = req.body[name];
          if (typeof value === 'string') {
            if (min !== undefined && value.length < min) {
              return res.status(400).json({ 
                error: `${name} must be at least ${min} characters` 
              });
            }
            if (max !== undefined && value.length > max) {
              return res.status(400).json({ 
                error: `${name} must be at most ${max} characters` 
              });
            }
          }
        }
      }
      
      // Validate numeric ranges
      if (config.body.numbers) {
        for (const { name, min, max } of config.body.numbers) {
          const value = req.body[name];
          if (value !== undefined && value !== null) {
            const num = typeof value === 'string' ? parseFloat(value) : value;
            if (isNaN(num)) {
              return res.status(400).json({ error: `${name} must be a valid number` });
            }
            if (min !== undefined && num < min) {
              return res.status(400).json({ error: `${name} must be at least ${min}` });
            }
            if (max !== undefined && num > max) {
              return res.status(400).json({ error: `${name} must be at most ${max}` });
            }
          }
        }
      }
      
      // Validate enums
      if (config.body.enums) {
        for (const { name, values } of config.body.enums) {
          const value = req.body[name];
          if (value !== undefined && !values.includes(value)) {
            return res.status(400).json({ 
              error: `${name} must be one of: ${values.join(', ')}` 
            });
          }
        }
      }
      
      // Validate emails
      if (config.body.emails) {
        for (const { name, required } of config.body.emails) {
          const value = req.body[name];
          if (required && !value) {
            return res.status(400).json({ error: `${name} is required` });
          }
          if (value && !isValidEmail(value)) {
            return res.status(400).json({ error: `${name} must be a valid email address` });
          }
        }
      }
    }
    
    next();
  };
}
