/**
 * Feature Flags - Controlează comportamentul aplicației
 * 
 * Configurația curentă: SPA-ONLY MODE
 * - Toate funcționalitățile sunt inline în dashboard
 * - Legacy routes redirect automat la /dashboard
 * - Utilizatorii nu pot accesa pagini separate
 */

export const FEATURES = {
  // ════════════════════════════════════════════════════════════
  // SPA MODE - Toate feature-urile sunt inline în dashboard
  // ════════════════════════════════════════════════════════════
  USE_SPA_DASHBOARD: true,           // Dashboard cu inline views
  USE_SPA_PLAN_GENERATOR: true,      // Generator inline (nu pagină separată)
  USE_SPA_MEAL_PLAN_VIEW: true,      // Vizualizare plan inline
  USE_SPA_PROGRESS_VIEW: true,       // Vizualizare progres inline
  
  // ════════════════════════════════════════════════════════════
  // LEGACY ROUTES - DEZACTIVATE COMPLET
  // ════════════════════════════════════════════════════════════
  ALLOW_LEGACY_ROUTES: false,        // ❌ Redirect forțat la /dashboard
  
  // ════════════════════════════════════════════════════════════
  // DEVELOPMENT & DEBUG
  // ════════════════════════════════════════════════════════════
  SHOW_LEGACY_LINKS_IN_SIDEBAR: false, // ❌ Nu arăta link-uri legacy
  DEBUG_ROUTING: false,                // ❌ Console logs pentru debugging
};

/**
 * Helper function pentru verificare feature
 * @param {string} featureName - Numele feature-ului din FEATURES
 * @returns {boolean} - true dacă feature-ul este activat
 */
export const isFeatureEnabled = (featureName) => {
  return FEATURES[featureName] ?? false;
};

/**
 * Verifică dacă aplicația rulează în SPA mode complet
 * @returns {boolean} - true dacă toate feature-urile SPA sunt activate
 */
export const isFullSPAMode = () => {
  return (
    FEATURES.USE_SPA_DASHBOARD &&
    FEATURES.USE_SPA_PLAN_GENERATOR &&
    FEATURES.USE_SPA_MEAL_PLAN_VIEW &&
    FEATURES.USE_SPA_PROGRESS_VIEW &&
    !FEATURES.ALLOW_LEGACY_ROUTES
  );
};

/**
 * Returnează URL-ul de redirect pentru utilizatori care accesează legacy routes
 * @returns {string} - URL-ul de redirect
 */
export const getDefaultRedirectURL = () => {
  return '/dashboard';
};
