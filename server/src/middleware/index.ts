// Authentication middleware
export {
  getAuthenticatedUser,
  isAdmin,
  hasProjectAccess,
  requireAuth,
  requireAdmin,
  requireProjectAccess,
  optionalAuth
} from './auth';

// Rate limiting middleware
export {
  rateLimit,
  strictRateLimit,
  standardRateLimit,
  generousRateLimit,
  uploadRateLimit,
  sendReportRateLimit,
  shareProjectRateLimit,
  aiChatBurstRateLimit,
  imageInferenceBurstRateLimit
} from './rateLimit';

export {
  stripDataUrlBase64,
  validateInlineImagePayload,
  validateBodyImageField
} from './imageInferencePayload';

// Validation middleware
export {
  isValidUUID,
  isValidUUIDAnyVersion,
  isValidEmail,
  sanitizeString,
  validateUUIDParam,
  validateRequiredFields,
  sanitizeBody,
  validateStringLength,
  validateNumericRange,
  validateEnum,
  validateEmailField,
  validate
} from './validation';
