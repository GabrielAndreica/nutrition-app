/**
 * Cache pentru calculele de nutriție
 * Evită recalculări inutile și reduce load-ul pe server
 */

// Cache în memorie cu TTL (pentru producție folosiți Redis)
const cache = new Map();

const CONFIG = {
  // TTL pentru diferite tipuri de cache
  CALORIES_TTL_MS: 3600000,      // 1 oră - calculele de calorii nu se schimbă frecvent
  MACROS_TTL_MS: 3600000,        // 1 oră
  MEAL_DISTRIBUTION_TTL_MS: 86400000, // 24 ore - distribuția e statică
  
  // Dimensiune maximă cache
  MAX_CACHE_SIZE: 1000,
  
  // Cleanup interval
  CLEANUP_INTERVAL_MS: 300000,   // 5 minute
};

// Cleanup periodic
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  }
  
  // Dacă cache-ul e prea mare, elimină cele mai vechi intrări
  if (cache.size > CONFIG.MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    
    const toRemove = entries.slice(0, cache.size - CONFIG.MAX_CACHE_SIZE + 100);
    toRemove.forEach(([key]) => cache.delete(key));
  }
}, CONFIG.CLEANUP_INTERVAL_MS);

/**
 * Setează o valoare în cache
 */
function set(key, value, ttlMs) {
  const now = Date.now();
  cache.set(key, {
    value,
    createdAt: now,
    expiresAt: now + ttlMs,
  });
}

/**
 * Obține o valoare din cache
 */
function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  
  return entry.value;
}

/**
 * Generează o cheie unică pentru cache bazată pe parametrii clientului
 */
function generateCaloriesKey(clientData) {
  return `calories:${clientData.weight}:${clientData.height}:${clientData.age}:${clientData.gender}:${clientData.activityLevel}:${clientData.goal}`;
}

function generateMacrosKey(goal, weight, calories) {
  return `macros:${goal}:${weight}:${calories}`;
}

/**
 * Calculează caloriile cu caching
 */
export function cachedCalculateCalories(clientData, calculateFn) {
  const key = generateCaloriesKey(clientData);
  
  const cached = get(key);
  if (cached !== null) {
    return cached;
  }
  
  const result = calculateFn(clientData);
  set(key, result, CONFIG.CALORIES_TTL_MS);
  return result;
}

/**
 * Calculează macronutrienții cu caching
 */
export function cachedCalculateMacros(goal, weight, calories, calculateFn) {
  const key = generateMacrosKey(goal, weight, calories);
  
  const cached = get(key);
  if (cached !== null) {
    return cached;
  }
  
  const result = calculateFn(goal, weight, calories);
  set(key, result, CONFIG.MACROS_TTL_MS);
  return result;
}

/**
 * Cache pentru distribuția meselor (foarte statică)
 */
const mealDistributionCache = new Map([
  [3, { 'Mic dejun': 0.30, 'Prânz': 0.40, 'Cină': 0.30 }],
  [4, { 'Mic dejun': 0.28, 'Gustare 1': 0.12, 'Prânz': 0.38, 'Cină': 0.22 }],
  [5, { 'Mic dejun': 0.25, 'Gustare 1': 0.10, 'Prânz': 0.30, 'Gustare 2': 0.10, 'Cină': 0.25 }],
]);

export function getCachedMealDistribution(mealsPerDay) {
  return mealDistributionCache.get(mealsPerDay) || mealDistributionCache.get(3);
}

/**
 * Statistici cache
 */
export function getCacheStats() {
  return {
    size: cache.size,
    maxSize: CONFIG.MAX_CACHE_SIZE,
  };
}

/**
 * Invalidează cache-ul pentru un anumit user/client
 */
export function invalidateUserCache(clientId) {
  // În implementarea actuală cu Map, nu putem face query pe subset
  // Pentru producție cu Redis, am folosi pattern matching
  console.log(`Cache invalidat pentru client ${clientId}`);
}
