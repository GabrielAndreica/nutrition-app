'use client';

import styles from './meal-plan.module.css';

export default function MealPlan({ plan, clientData }) {
  const parseMealPlan = (planText) => {
    const lines = planText.split('\n').map(line => line.trim()).filter(line => line);
    const meals = {};
    let currentMeal = null;
    let currentItems = [];

    lines.forEach(line => {
      const lowerLine = line.toLowerCase();
      
      // Detectează anteturile mesei
      let mealType = null;
      
      // Detectează "Masa 1", "Masa 2" etc.
      const mealMatch = lowerLine.match(/masa\s+(\d+)/);
      if (mealMatch) {
        const mealNumber = parseInt(mealMatch[1]);
        mealType = `meal_${mealNumber}`;
      }
      // Fallback la etichete vechi dacă nu sunt găsite "Masa X"
      else if (
        lowerLine.includes('mic dejun') ||
        lowerLine.includes('breakfast') ||
        lowerLine.includes('micul dejun')
      ) {
        mealType = 'breakfast';
      } else if (
        lowerLine.includes('prânz') ||
        lowerLine.includes('lunch')
      ) {
        mealType = 'lunch';
      } else if (
        lowerLine.includes('cină') ||
        lowerLine.includes('dinner')
      ) {
        mealType = 'dinner';
      } else if (
        lowerLine.includes('gustări') ||
        lowerLine.includes('snack')
      ) {
        mealType = 'snacks';
      }

      // Dacă am găsit un antet de masă nou
      if (mealType) {
        if (currentMeal && currentItems.length > 0) {
          meals[currentMeal] = currentItems;
        }
        currentMeal = mealType;
        currentItems = [];
      } else if (currentMeal && line && !line.startsWith('**')) {
        // Elimina markdown și gloanțe
        const cleanLine = line.replace(/^[-*•]\s*/, '').replace(/\*\*/g, '');
        if (cleanLine && !cleanLine.includes('---')) {
          currentItems.push(cleanLine);
        }
      }
    });

    // Adaugă ultima masă
    if (currentMeal && currentItems.length > 0) {
      meals[currentMeal] = currentItems;
    }

    return meals;
  };

  const meals = parseMealPlan(plan);

  const mealLabels = {
    meal_1: { name: 'Masa 1', emoji: '🌅', order: 1 },
    meal_2: { name: 'Masa 2', emoji: '☀️', order: 2 },
    meal_3: { name: 'Masa 3', emoji: '🍎', order: 3 },
    meal_4: { name: 'Masa 4', emoji: '🥗', order: 4 },
    meal_5: { name: 'Masa 5', emoji: '🌙', order: 5 },
    // Fallback labels pentru format vechi
    breakfast: { name: 'Mic Dejun', emoji: '🌅', order: 1 },
    lunch: { name: 'Prânz', emoji: '☀️', order: 2 },
    snacks: { name: 'Gustări', emoji: '🍎', order: 3 },
    snacks_2: { name: 'Gustări 2', emoji: '🥗', order: 4 },
    snacks_3: { name: 'Gustări 3', emoji: '🍌', order: 5 },
    dinner: { name: 'Cină', emoji: '🌙', order: 6 },
  };

  const goalLabels = {
    weight_loss: 'Slăbit',
    muscle_gain: 'Creștere masă musculară',
    maintenance: 'Menținere',
    recomposition: 'Recompoziție corporală',
  };

  const dietLabels = {
    omnivore: 'Omnivor',
    vegetarian: 'Vegetarian',
    vegan: 'Vegan',
  };

  return (
    <div className={styles.container}>
      <div className={styles.clientSummary}>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryItem}>
            <span className={styles.label}>Client</span>
            <span className={styles.value}>{clientData.name}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.label}>Vârstă</span>
            <span className={styles.value}>{clientData.age} ani</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.label}>Obiectiv</span>
            <span className={styles.value}>{goalLabels[clientData.goal]}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.label}>Dietă</span>
            <span className={styles.value}>{dietLabels[clientData.dietType]}</span>
          </div>
        </div>
      </div>

      <div className={styles.mealsGrid}>
        {Object.entries(meals)
          .sort(([keyA], [keyB]) => (mealLabels[keyA]?.order || 0) - (mealLabels[keyB]?.order || 0))
          .map(([mealType, items]) => {
            if (!items || items.length === 0) return null;

            const { name, emoji } = mealLabels[mealType];

            return (
            <div key={mealType} className={styles.mealCard}>
              <div className={styles.mealCardHeader}>
                <span className={styles.mealEmoji}>{emoji}</span>
                <h4>{name}</h4>
              </div>
              <ul className={styles.mealList}>
                {items.slice(0, 4).map((item, index) => (
                  <li key={index} className={styles.mealItem}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
