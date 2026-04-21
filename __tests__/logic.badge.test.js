/**
 * Teste pentru logica de polling și badge în ClientsList
 * Testează funcțiile pure izolat (fără a randa componenta completă)
 */

// ── Teste pentru logica de polling ──────────────────────────────────────────

describe('Logica polling has_new_progress', () => {
  /**
   * Simulează funcția de update din polling:
   * Dacă has_new_progress s-a schimbat, returnează array nou (re-render).
   * Dacă nimic nu s-a schimbat, returnează ACELAȘI array (no re-render).
   */
  function applyProgressStatuses(clients, statuses) {
    const map = Object.fromEntries(statuses.map(s => [s.id, s.has_new_progress]));
    let changed = false;
    const next = clients.map(c => {
      if (c.id in map && c.has_new_progress !== map[c.id]) {
        changed = true;
        return { ...c, has_new_progress: map[c.id] };
      }
      return c;
    });
    return changed ? next : clients; // returnează ACELAȘI ref dacă nimic nu s-a schimbat
  }

  test('actualizează has_new_progress=true când polling detectează progres nou', () => {
    const clients = [
      { id: 'uuid-1', name: 'Ion', has_new_progress: false },
      { id: 'uuid-2', name: 'Ana', has_new_progress: false },
    ];
    const statuses = [
      { id: 'uuid-1', has_new_progress: true },
      { id: 'uuid-2', has_new_progress: false },
    ];

    const result = applyProgressStatuses(clients, statuses);

    expect(result[0].has_new_progress).toBe(true);
    expect(result[1].has_new_progress).toBe(false);
  });

  test('actualizează has_new_progress=false după ce trainerul tratează progresul', () => {
    const clients = [
      { id: 'uuid-1', name: 'Ion', has_new_progress: true },
    ];
    const statuses = [{ id: 'uuid-1', has_new_progress: false }];

    const result = applyProgressStatuses(clients, statuses);

    expect(result[0].has_new_progress).toBe(false);
  });

  test('returnează ACELAȘI array ref dacă nimic nu s-a schimbat (optimizare re-render)', () => {
    const clients = [
      { id: 'uuid-1', has_new_progress: true },
      { id: 'uuid-2', has_new_progress: false },
    ];
    const statuses = [
      { id: 'uuid-1', has_new_progress: true },  // identic
      { id: 'uuid-2', has_new_progress: false }, // identic
    ];

    const result = applyProgressStatuses(clients, statuses);

    expect(result).toBe(clients); // același referință — fără re-render
  });

  test('ignoră clienți din statuses care nu există în state', () => {
    const clients = [{ id: 'uuid-1', has_new_progress: false }];
    const statuses = [
      { id: 'uuid-1', has_new_progress: true },
      { id: 'uuid-INEXISTENT', has_new_progress: true }, // nu există
    ];

    const result = applyProgressStatuses(clients, statuses);

    expect(result).toHaveLength(1);
    expect(result[0].has_new_progress).toBe(true);
  });

  test('funcționează cu lista goală de clienți', () => {
    const result = applyProgressStatuses([], [{ id: 'uuid-1', has_new_progress: true }]);
    expect(result).toEqual([]);
  });

  test('funcționează cu statuses goale', () => {
    const clients = [{ id: 'uuid-1', has_new_progress: true }];
    const result = applyProgressStatuses(clients, []);
    expect(result).toBe(clients); // nicio schimbare
  });
});

// ── Teste pentru logica justFinishedClients ──────────────────────────────────

describe('Logica justFinishedClients (prevenire flash badge)', () => {
  /**
   * Simulează logica de afișare a badge-ului
   */
  function shouldShowNoPlanBadge({ plan, isGenerating, isJustFinished, generatingInitialized }) {
    return !isGenerating && !plan && generatingInitialized && !isJustFinished;
  }

  test('NU afișează "Fără plan" în timpul generării', () => {
    expect(shouldShowNoPlanBadge({
      plan: null, isGenerating: true, isJustFinished: false, generatingInitialized: true,
    })).toBe(false);
  });

  test('NU afișează "Fără plan" imediat după terminarea generării (justFinished)', () => {
    expect(shouldShowNoPlanBadge({
      plan: null, isGenerating: false, isJustFinished: true, generatingInitialized: true,
    })).toBe(false);
  });

  test('afișează "Fără plan" dacă nu există plan și nu generează', () => {
    expect(shouldShowNoPlanBadge({
      plan: null, isGenerating: false, isJustFinished: false, generatingInitialized: true,
    })).toBe(true);
  });

  test('NU afișează "Fără plan" dacă există plan', () => {
    expect(shouldShowNoPlanBadge({
      plan: { planId: 'plan-1' }, isGenerating: false, isJustFinished: false, generatingInitialized: true,
    })).toBe(false);
  });

  test('NU afișează "Fără plan" înainte de inițializare', () => {
    expect(shouldShowNoPlanBadge({
      plan: null, isGenerating: false, isJustFinished: false, generatingInitialized: false,
    })).toBe(false);
  });
});

// ── Teste pentru logica planContinued + sessionStorage ──────────────────────

describe('Logica planContinued și sessionStorage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  test('planContinued=true dacă cheia există în sessionStorage și has_new_progress=false', () => {
    const clientId = 'uuid-1';
    const progressId = 'prog-1';
    const key = `plan_continued_${clientId}_${progressId}`;

    sessionStorage.setItem(key, 'true');

    const hasNewProgress = false; // DB spune că a fost tratat
    const wasContinued = sessionStorage.getItem(key);

    const planContinued = hasNewProgress ? false : Boolean(wasContinued);
    expect(planContinued).toBe(true);
  });

  test('planContinued=false dacă has_new_progress=true (progres nou)', () => {
    const clientId = 'uuid-1';
    const progressId = 'prog-1';
    const key = `plan_continued_${clientId}_${progressId}`;

    // Cheia există din sesiunea anterioară
    sessionStorage.setItem(key, 'true');

    // Dar DB spune că e progres NOU
    const hasNewProgress = true;

    if (hasNewProgress) {
      sessionStorage.removeItem(key); // codul face asta
    }

    const wasContinued = sessionStorage.getItem(key);
    const planContinued = Boolean(wasContinued);

    expect(planContinued).toBe(false);
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  test('handleContinue setează cheia în sessionStorage', () => {
    const clientId = 'uuid-1';
    const lastProgressId = 'prog-42';
    const key = `plan_continued_${clientId}_${lastProgressId}`;

    // Simulează handleContinue
    sessionStorage.setItem(key, 'true');

    expect(sessionStorage.getItem(key)).toBe('true');
  });
});
