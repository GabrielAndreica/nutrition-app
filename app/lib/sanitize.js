// ============================================
// Sanitization Helpers pentru XSS Protection
// ============================================

/**
 * Sanitizează un string pentru a preveni XSS attacks
 * Convertește caractere speciale HTML în entități
 */
export function sanitizeHTML(input) {
  if (!input || typeof input !== 'string') return '';
  
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitizează un obiect întreg (recursiv)
 * Folositor pentru request bodies
 */
export function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeHTML(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Validează și sanitizează email
 */
export function sanitizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  
  // Trim whitespace
  email = email.trim().toLowerCase();
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Format de email invalid');
  }
  
  // Remove any HTML tags
  return sanitizeHTML(email);
}

/**
 * Sanitizează nume (permite doar litere, spații, cratimă, apostrof)
 */
export function sanitizeName(name) {
  if (!name || typeof name !== 'string') return '';
  
  // Trim whitespace
  name = name.trim();
  
  // Remove orice caracter care nu e literă, spațiu, cratimă sau apostrof
  name = name.replace(/[^a-zA-ZăâîșțĂÂÎȘȚ\s'-]/g, '');
  
  // Limitează la 100 caractere
  return name.slice(0, 100);
}

/**
 * Sanitizează text liber (notes, preferences, etc.)
 * Permite text normal dar elimină HTML/script tags
 */
export function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  
  // Trim whitespace
  text = text.trim();
  
  // Remove HTML tags completely
  text = text.replace(/<[^>]*>/g, '');
  
  // Remove script tags și conținutul lor
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove event handlers (onclick, onerror, etc.)
  text = text.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
  text = text.replace(/on\w+\s*=\s*[^\s>]*/gi, '');
  
  // Remove javascript: protocol
  text = text.replace(/javascript:/gi, '');
  
  // Sanitize HTML entities
  text = sanitizeHTML(text);
  
  return text;
}

/**
 * Sanitizează număr (weight, calories, etc.)
 */
export function sanitizeNumber(value, { min = null, max = null, allowFloat = true } = {}) {
  // Convert to number
  const num = allowFloat ? parseFloat(value) : parseInt(value, 10);
  
  // Check if valid number
  if (isNaN(num)) {
    throw new Error('Valoare numerică invalidă');
  }
  
  // Check min/max constraints
  if (min !== null && num < min) {
    throw new Error(`Valoarea trebuie să fie cel puțin ${min}`);
  }
  if (max !== null && num > max) {
    throw new Error(`Valoarea trebuie să fie maxim ${max}`);
  }
  
  return num;
}

/**
 * Sanitizează array de strings
 */
export function sanitizeArray(arr, sanitizeFunc = sanitizeText) {
  if (!Array.isArray(arr)) return [];
  
  return arr
    .filter(item => item != null)
    .map(item => sanitizeFunc(item))
    .filter(item => item.length > 0);
}

/**
 * Validează și sanitizează restricții alimentare
 */
export function sanitizeFoodRestrictions(restrictions) {
  if (!restrictions || typeof restrictions !== 'string') return '';
  
  // Sanitize ca text
  let sanitized = sanitizeText(restrictions);
  
  // Limitează la 1000 caractere
  sanitized = sanitized.slice(0, 1000);
  
  return sanitized;
}

/**
 * Validează și sanitizează preferințe culinare
 */
export function sanitizeFoodPreferences(preferences) {
  if (!preferences || typeof preferences !== 'string') return '';
  
  // Sanitize ca text
  let sanitized = sanitizeText(preferences);
  
  // Limitează la 1000 caractere
  sanitized = sanitized.slice(0, 1000);
  
  return sanitized;
}

/**
 * Helper pentru logging sanitizat (nu loga informații sensibile)
 */
export function sanitizeForLog(data) {
  if (!data || typeof data !== 'object') return data;
  
  const sensitiveKeys = ['password', 'token', 'jwt', 'secret', 'apiKey', 'api_key'];
  const sanitized = { ...data };
  
  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

// ============================================
// Exemple de utilizare
// ============================================

/*
// Exemplu 1: Sanitizare input client
const clientData = {
  name: sanitizeName(req.body.name),
  email: sanitizeEmail(req.body.email),
  notes: sanitizeText(req.body.notes),
  foodRestrictions: sanitizeFoodRestrictions(req.body.foodRestrictions),
  age: sanitizeNumber(req.body.age, { min: 10, max: 120 }),
  weight: sanitizeNumber(req.body.weight, { min: 20, max: 300 })
};

// Exemplu 2: Sanitizare meal plan request
const mealPlanData = {
  clientId: req.body.clientId, // UUID, nu necesită sanitizare
  targetCalories: sanitizeNumber(req.body.targetCalories, { min: 800, max: 5000 }),
  restrictions: sanitizeFoodRestrictions(req.body.restrictions),
  preferences: sanitizeFoodPreferences(req.body.preferences),
  notes: sanitizeText(req.body.notes)
};

// Exemplu 3: Sanitizare întreg obiect
const sanitizedBody = sanitizeObject(req.body);
*/
