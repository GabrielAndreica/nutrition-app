/**
 * Rate Limiter pentru scalabilitate
 * Previne supraîncărcarea API-ului OpenAI și asigură fair-use între antrenori
 */

// Stochează cererile per user (în memorie - pentru producție folosiți Redis)
const userRequests = new Map();
const globalQueue = [];
let activeRequests = 0;

// Configurare
const CONFIG = {
  // Rate limiting per user
  MAX_REQUESTS_PER_USER_PER_MINUTE: 3,
  MAX_REQUESTS_PER_USER_PER_HOUR: 20,
  
  // Global concurrency (OpenAI rate limits)
  // Setăm la 1 pentru a genera planurile SECVENȚIAL - unul după altul
  // Astfel nu se depășește niciodată rate limit-ul OpenAI
  MAX_CONCURRENT_REQUESTS: 1,
  
  // Queue settings
  MAX_QUEUE_SIZE: 100,
  QUEUE_TIMEOUT_MS: 120000, // 2 minute max wait in queue
  
  // Cleanup interval
  CLEANUP_INTERVAL_MS: 60000, // cleanup every minute
};

// Cleanup periodic pentru memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of userRequests.entries()) {
    // Elimină timestamps vechi
    data.minuteRequests = data.minuteRequests.filter(t => now - t < 60000);
    data.hourRequests = data.hourRequests.filter(t => now - t < 3600000);
    
    // Elimină user-ul dacă nu are activitate recentă
    if (data.minuteRequests.length === 0 && data.hourRequests.length === 0) {
      userRequests.delete(userId);
    }
  }
}, CONFIG.CLEANUP_INTERVAL_MS);

/**
 * Verifică și actualizează rate limit pentru un user
 * @param {string} userId 
 * @returns {{ allowed: boolean, retryAfter?: number, reason?: string }}
 */
export function checkRateLimit(userId) {
  const now = Date.now();
  
  if (!userRequests.has(userId)) {
    userRequests.set(userId, {
      minuteRequests: [],
      hourRequests: [],
    });
  }
  
  const userData = userRequests.get(userId);
  
  // Cleanup timestamps expirate
  userData.minuteRequests = userData.minuteRequests.filter(t => now - t < 60000);
  userData.hourRequests = userData.hourRequests.filter(t => now - t < 3600000);
  
  // Verifică limita pe minut
  if (userData.minuteRequests.length >= CONFIG.MAX_REQUESTS_PER_USER_PER_MINUTE) {
    const oldestMinute = userData.minuteRequests[0];
    const retryAfter = Math.ceil((60000 - (now - oldestMinute)) / 1000);
    return {
      allowed: false,
      retryAfter,
      reason: `Ai atins limita de ${CONFIG.MAX_REQUESTS_PER_USER_PER_MINUTE} generări pe minut. Încearcă din nou în ${retryAfter} secunde.`,
    };
  }
  
  // Verifică limita pe oră
  if (userData.hourRequests.length >= CONFIG.MAX_REQUESTS_PER_USER_PER_HOUR) {
    const oldestHour = userData.hourRequests[0];
    const retryAfter = Math.ceil((3600000 - (now - oldestHour)) / 1000);
    const minutes = Math.ceil(retryAfter / 60);
    return {
      allowed: false,
      retryAfter,
      reason: `Ai atins limita de ${CONFIG.MAX_REQUESTS_PER_USER_PER_HOUR} generări pe oră. Încearcă din nou în ${minutes} minute.`,
    };
  }
  
  // Înregistrează cererea
  userData.minuteRequests.push(now);
  userData.hourRequests.push(now);
  
  return { allowed: true };
}

/**
 * Request Queue pentru gestionarea concurenței globale
 */
export class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = 0;
  }
  
  /**
   * Adaugă o cerere în queue și așteaptă să fie procesată
   * @param {string} requestId - ID unic pentru cerere
   * @returns {Promise<void>}
   */
  async waitForSlot(requestId) {
    // Dacă avem slot disponibil, procesează imediat
    if (this.processing < CONFIG.MAX_CONCURRENT_REQUESTS) {
      this.processing++;
      return;
    }
    
    // Verifică dacă queue-ul e plin
    if (this.queue.length >= CONFIG.MAX_QUEUE_SIZE) {
      throw new Error('Serverul este supraîncărcat. Te rog încearcă din nou în câteva minute.');
    }
    
    // Adaugă în queue și așteaptă
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Elimină din queue dacă timeout
        const index = this.queue.findIndex(item => item.requestId === requestId);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        reject(new Error('Cererea a expirat în queue. Te rog încearcă din nou.'));
      }, CONFIG.QUEUE_TIMEOUT_MS);
      
      this.queue.push({
        requestId,
        resolve: () => {
          clearTimeout(timeoutId);
          this.processing++;
          resolve();
        },
        reject,
        timestamp: Date.now(),
      });
    });
  }
  
  /**
   * Eliberează un slot și procesează următoarea cerere din queue
   */
  releaseSlot() {
    this.processing--;
    
    // Procesează următoarea cerere din queue
    if (this.queue.length > 0 && this.processing < CONFIG.MAX_CONCURRENT_REQUESTS) {
      const next = this.queue.shift();
      next.resolve();
    }
  }
  
  /**
   * Returnează statistici despre queue
   */
  getStats() {
    return {
      processing: this.processing,
      queued: this.queue.length,
      maxConcurrent: CONFIG.MAX_CONCURRENT_REQUESTS,
      maxQueueSize: CONFIG.MAX_QUEUE_SIZE,
    };
  }
}

// Singleton instance
export const requestQueue = new RequestQueue();

/**
 * Decorator pentru funcții async care necesită rate limiting și queue
 * @param {Function} fn - Funcția de executat
 * @param {string} userId - ID-ul user-ului
 * @param {string} requestId - ID unic pentru cerere
 */
export async function withRateLimitAndQueue(fn, userId, requestId) {
  // 1. Verifică rate limit
  const rateCheck = checkRateLimit(userId);
  if (!rateCheck.allowed) {
    const error = new Error(rateCheck.reason);
    error.retryAfter = rateCheck.retryAfter;
    error.isRateLimit = true;
    throw error;
  }
  
  // 2. Așteaptă slot în queue
  await requestQueue.waitForSlot(requestId);
  
  try {
    // 3. Execută funcția
    return await fn();
  } finally {
    // 4. Eliberează slot-ul
    requestQueue.releaseSlot();
  }
}

/**
 * Generează un request ID unic
 */
export function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
