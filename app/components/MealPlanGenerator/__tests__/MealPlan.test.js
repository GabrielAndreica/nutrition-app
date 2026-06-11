/**
 * MealPlan component — production tests
 * Covers: canEdit gate, deleteMeal, addMeal, changeMealName (spaces preserved),
 * deleteFood, addFood (merge dedup), updateFoodAmount (_per100g accuracy),
 * onViewProgress / onSubmitProgress button visibility, immutability.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@/app/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('next/dynamic', () => () => () => null);

// Suppress async fetch calls (weight history, usage recording, etc.)
beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  );
});

// AddFoodModal mock: two buttons — one adds a NEW food, one adds an EXISTING food (for merge test)
jest.mock('../AddFoodModal', () =>
  function MockAddFoodModal({ isOpen, onAdd }) {
    if (!isOpen) return null;
    return (
      <div data-testid="add-food-modal">
        <button
          data-testid="mock-add-food-new"
          onClick={() =>
            onAdd({
              name: 'Broccoli',
              amount: 100,
              unit: 'g',
              calories: 35,
              protein: 2.4,
              carbs: 7,
              fat: 0.4,
              _per100g: { calories: 35, protein: 2.4, carbs: 7, fat: 0.4 },
            })
          }
        >
          Add New Food
        </button>
        <button
          data-testid="mock-add-food-existing"
          onClick={() =>
            onAdd({
              name: 'Piept de pui',
              amount: 50,
              unit: 'g',
              calories: 60,
              protein: 11,
              carbs: 0,
              fat: 1.3,
              _per100g: { calories: 120, protein: 22, carbs: 0, fat: 2.6 },
            })
          }
        >
          Add Existing Food
        </button>
      </div>
    );
  }
);

// AddMealModal mock: returns one resolved meal on click
jest.mock('../AddMealModal', () =>
  function MockAddMealModal({ isOpen, onAdd }) {
    if (!isOpen) return null;
    return (
      <button
        data-testid="mock-add-meal"
        onClick={() =>
          onAdd({
            name: 'Cină',
            mealType: 'dinner',
            foods: [],
            preparation: '',
            mealTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
          })
        }
      >
        Add Meal
      </button>
    );
  }
);

import { useAuth } from '@/app/contexts/AuthContext';
import MealPlan from '../MealPlan';

// ── Fixtures ───────────────────────────────────────────────────────────────

const trainerUser = { role: 'trainer', id: 'trainer-1' };
const clientUser  = { role: 'client',  id: 'client-1'  };

const makeFood = (overrides = {}) => ({
  name: 'Piept de pui',
  amount: 100,
  unit: 'g',
  calories: 120,
  protein: 22,
  carbs: 0,
  fat: 2.6,
  _per100g: { calories: 120, protein: 22, carbs: 0, fat: 2.6 },
  ...overrides,
});

const makeMeal = (overrides = {}) => ({
  name: 'Masă 1',
  mealType: 'lunch',
  foods: [makeFood()],
  preparation: '',
  mealTotals: { calories: 120, protein: 22, carbs: 0, fat: 2.6 },
  ...overrides,
});

const makeDay = (meals) => ({
  meals: meals || [makeMeal()],
  dailyTotals: null,
});

const makePlan = (meals) => ({
  clientName: 'Test',
  days: Array.from({ length: 7 }, () => makeDay(meals)),
});

function renderMealPlan({
  user = trainerUser,
  plan,
  editableAmounts = true,
  onPlanChange,
  onPlanDirtyChange,
  onViewProgress,
  onSubmitProgress,
  hideReviewActions = true,
} = {}) {
  useAuth.mockReturnValue({ user });
  const mockedChange = onPlanChange || jest.fn();
  const mockedDirty  = onPlanDirtyChange || jest.fn();
  render(
    <MealPlan
      plan={plan || makePlan()}
      clientData={{ name: 'Test Client' }}
      editableAmounts={editableAmounts}
      onPlanChange={mockedChange}
      onPlanDirtyChange={mockedDirty}
      onViewProgress={onViewProgress}
      onSubmitProgress={onSubmitProgress}
      hideReviewActions={hideReviewActions}
    />
  );
  return { onPlanChange: mockedChange, onPlanDirtyChange: mockedDirty };
}

// ── canEdit gate ───────────────────────────────────────────────────────────

describe('canEdit gate', () => {
  it('renders delete-meal and delete-food buttons for trainer', () => {
    renderMealPlan();
    expect(screen.getByLabelText('Șterge masa')).toBeInTheDocument();
    expect(screen.getByLabelText('Șterge aliment')).toBeInTheDocument();
  });

  it('does NOT render edit controls for client user', () => {
    renderMealPlan({ user: clientUser });
    expect(screen.queryByLabelText('Șterge masa')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Șterge aliment')).not.toBeInTheDocument();
  });

  it('does NOT render edit controls when editableAmounts=false', () => {
    renderMealPlan({ editableAmounts: false });
    expect(screen.queryByLabelText('Șterge masa')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Șterge aliment')).not.toBeInTheDocument();
  });

  it('does NOT render edit controls when onPlanChange is not provided', () => {
    useAuth.mockReturnValue({ user: trainerUser });
    render(
      <MealPlan
        plan={makePlan()}
        clientData={{ name: 'Test' }}
        editableAmounts={true}
        hideReviewActions
      />
    );
    expect(screen.queryByLabelText('Șterge masa')).not.toBeInTheDocument();
  });
});

// ── deleteMeal ─────────────────────────────────────────────────────────────

describe('deleteMeal', () => {
  it('removes the correct meal and calls onPlanChange', () => {
    const plan = makePlan([
      makeMeal({ name: 'Masă 1' }),
      makeMeal({ name: 'Masă 2', foods: [] }),
    ]);
    const { onPlanChange } = renderMealPlan({ plan });

    const deleteButtons = screen.getAllByLabelText('Șterge masa');
    fireEvent.click(deleteButtons[0]);

    expect(onPlanChange).toHaveBeenCalledTimes(1);
    const nextPlan = onPlanChange.mock.calls[0][0];
    expect(nextPlan.days[0].meals).toHaveLength(1);
    expect(nextPlan.days[0].meals[0].name).toBe('Masă 2');
  });

  it('marks plan dirty after delete', () => {
    const { onPlanDirtyChange } = renderMealPlan();
    fireEvent.click(screen.getByLabelText('Șterge masa'));
    expect(onPlanDirtyChange).toHaveBeenCalledWith(true);
  });

  it('does not mutate the original plan', () => {
    const plan = makePlan([makeMeal()]);
    const original = JSON.parse(JSON.stringify(plan));
    renderMealPlan({ plan });
    fireEvent.click(screen.getByLabelText('Șterge masa'));
    expect(plan).toEqual(original);
  });
});

// ── addMeal ────────────────────────────────────────────────────────────────

describe('addMeal', () => {
  it('appends the resolved meal returned by modal', () => {
    const { onPlanChange } = renderMealPlan();
    fireEvent.click(screen.getByText('Adaugă masă'));
    fireEvent.click(screen.getByTestId('mock-add-meal'));

    expect(onPlanChange).toHaveBeenCalledTimes(1);
    const nextPlan = onPlanChange.mock.calls[0][0];
    expect(nextPlan.days[0].meals).toHaveLength(2);
    expect(nextPlan.days[0].meals[1].name).toBe('Cină');
    expect(nextPlan.days[0].meals[1].mealType).toBe('dinner');
  });

  it('marks plan dirty after add', () => {
    const { onPlanDirtyChange } = renderMealPlan();
    fireEvent.click(screen.getByText('Adaugă masă'));
    fireEvent.click(screen.getByTestId('mock-add-meal'));
    expect(onPlanDirtyChange).toHaveBeenCalledWith(true);
  });
});

// ── changeMealName ─────────────────────────────────────────────────────────

describe('changeMealName', () => {
  it('preserves trailing spaces — does NOT trim on each keystroke', () => {
    const { onPlanChange } = renderMealPlan();
    const input = screen.getByPlaceholderText('Nume masă');
    fireEvent.change(input, { target: { value: 'Masa cu spatiu ' } });
    const nextPlan = onPlanChange.mock.calls[0][0];
    expect(nextPlan.days[0].meals[0].name).toBe('Masa cu spatiu ');
  });

  it('strips HTML tags from name (XSS guard)', () => {
    const { onPlanChange } = renderMealPlan();
    const input = screen.getByPlaceholderText('Nume masă');
    fireEvent.change(input, { target: { value: '<b>Cina</b>' } });
    const nextPlan = onPlanChange.mock.calls[0][0];
    expect(nextPlan.days[0].meals[0].name).toBe('Cina');
  });

  it('truncates name to 50 characters', () => {
    const { onPlanChange } = renderMealPlan();
    const input = screen.getByPlaceholderText('Nume masă');
    fireEvent.change(input, { target: { value: 'x'.repeat(60) } });
    const nextPlan = onPlanChange.mock.calls[0][0];
    expect(nextPlan.days[0].meals[0].name).toHaveLength(50);
  });
});

// ── deleteFood ─────────────────────────────────────────────────────────────

describe('deleteFood', () => {
  it('removes the correct food from the meal', () => {
    const plan = makePlan([
      makeMeal({
        foods: [makeFood({ name: 'Somon' }), makeFood({ name: 'Orez alb' })],
      }),
    ]);
    const { onPlanChange } = renderMealPlan({ plan });

    const deleteButtons = screen.getAllByLabelText('Șterge aliment');
    fireEvent.click(deleteButtons[0]);

    const nextPlan = onPlanChange.mock.calls[0][0];
    expect(nextPlan.days[0].meals[0].foods).toHaveLength(1);
    expect(nextPlan.days[0].meals[0].foods[0].name).toBe('Orez alb');
  });

  it('marks plan dirty after food delete', () => {
    const { onPlanDirtyChange } = renderMealPlan();
    fireEvent.click(screen.getByLabelText('Șterge aliment'));
    expect(onPlanDirtyChange).toHaveBeenCalledWith(true);
  });
});

// ── addFood ────────────────────────────────────────────────────────────────

describe('addFood', () => {
  it('adds a new food to the meal foods list', () => {
    const { onPlanChange } = renderMealPlan();
    fireEvent.click(screen.getByText('+ Adaugă aliment'));
    fireEvent.click(screen.getByTestId('mock-add-food-new'));

    const nextPlan = onPlanChange.mock.calls[0][0];
    const foods = nextPlan.days[0].meals[0].foods;
    expect(foods).toHaveLength(2);
    expect(foods[1].name).toBe('Broccoli');
  });

  it('merges food with same normalized name instead of duplicating', () => {
    const { onPlanChange } = renderMealPlan();
    fireEvent.click(screen.getByText('+ Adaugă aliment'));
    fireEvent.click(screen.getByTestId('mock-add-food-existing'));

    const nextPlan = onPlanChange.mock.calls[0][0];
    const foods = nextPlan.days[0].meals[0].foods;
    expect(foods).toHaveLength(1); // merged, not duplicated
    expect(foods[0].amount).toBe(150); // 100 original + 50 added
  });

  it('recalculates merged food macros using fresh _per100g values', () => {
    const { onPlanChange } = renderMealPlan();
    fireEvent.click(screen.getByText('+ Adaugă aliment'));
    fireEvent.click(screen.getByTestId('mock-add-food-existing'));

    const food = onPlanChange.mock.calls[0][0].days[0].meals[0].foods[0];
    // 150g × (120 kcal / 100g) = 180 kcal
    expect(food.calories).toBe(180);
    // 150g × (22g protein / 100g) = 33g
    expect(food.protein).toBe(33);
  });
});

// ── updateFoodAmount ───────────────────────────────────────────────────────

describe('updateFoodAmount', () => {
  it('uses _per100g for accurate macro recalculation', () => {
    const { onPlanChange } = renderMealPlan();
    const amountInput = screen.getByRole('spinbutton', { name: 'Gramaj Piept de pui' });
    fireEvent.change(amountInput, { target: { value: '50' } });

    const food = onPlanChange.mock.calls[0][0].days[0].meals[0].foods[0];
    expect(food.amount).toBe(50);
    expect(food.calories).toBe(60);  // 120 × 50/100
    expect(food.protein).toBe(11);   // 22 × 50/100
  });

  it('rounds amount to nearest 5', () => {
    const { onPlanChange } = renderMealPlan();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Gramaj Piept de pui' }), { target: { value: '53' } });
    expect(onPlanChange.mock.calls[0][0].days[0].meals[0].foods[0].amount).toBe(55);
  });

  it('enforces minimum of 5g', () => {
    const { onPlanChange } = renderMealPlan();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Gramaj Piept de pui' }), { target: { value: '1' } });
    expect(onPlanChange.mock.calls[0][0].days[0].meals[0].foods[0].amount).toBe(5);
  });

  it('stepper minus button decrements by 5', () => {
    const { onPlanChange } = renderMealPlan();
    fireEvent.click(screen.getByLabelText('Scade gramajul'));
    expect(onPlanChange.mock.calls[0][0].days[0].meals[0].foods[0].amount).toBe(95);
  });

  it('stepper plus button increments by 5', () => {
    const { onPlanChange } = renderMealPlan();
    fireEvent.click(screen.getByLabelText('Crește gramajul'));
    expect(onPlanChange.mock.calls[0][0].days[0].meals[0].foods[0].amount).toBe(105);
  });
});

// ── button visibility — onViewProgress / onSubmitProgress ─────────────────

describe('button visibility', () => {
  it('shows "Vizualizează progres" when onViewProgress is provided', () => {
    renderMealPlan({ hideReviewActions: false, onViewProgress: jest.fn() });
    expect(screen.getByText('Vizualizează progres')).toBeInTheDocument();
  });

  it('shows "Trimite progres" when onSubmitProgress is provided', () => {
    renderMealPlan({ hideReviewActions: false, onSubmitProgress: jest.fn() });
    expect(screen.getByText('Trimite progres')).toBeInTheDocument();
  });

  it('renders both buttons independently when both callbacks provided', () => {
    renderMealPlan({
      hideReviewActions: false,
      onViewProgress: jest.fn(),
      onSubmitProgress: jest.fn(),
    });
    expect(screen.getByText('Vizualizează progres')).toBeInTheDocument();
    expect(screen.getByText('Trimite progres')).toBeInTheDocument();
  });

  it('calls onViewProgress when its button is clicked', () => {
    const onViewProgress = jest.fn();
    renderMealPlan({ hideReviewActions: false, onViewProgress });
    fireEvent.click(screen.getByText('Vizualizează progres'));
    expect(onViewProgress).toHaveBeenCalledTimes(1);
  });

  it('hides all progress buttons when hideReviewActions=true', () => {
    renderMealPlan({
      hideReviewActions: true,
      onViewProgress: jest.fn(),
      onSubmitProgress: jest.fn(),
    });
    expect(screen.queryByText('Vizualizează progres')).not.toBeInTheDocument();
    expect(screen.queryByText('Trimite progres')).not.toBeInTheDocument();
  });
});

// ── empty plan guard ───────────────────────────────────────────────────────

describe('empty plan guard', () => {
  it('renders fallback when plan is null', () => {
    useAuth.mockReturnValue({ user: trainerUser });
    render(<MealPlan plan={null} clientData={{}} hideReviewActions />);
    expect(screen.getByText('Nu s-a putut genera planul.')).toBeInTheDocument();
  });

  it('renders fallback when plan has no days', () => {
    useAuth.mockReturnValue({ user: trainerUser });
    render(<MealPlan plan={{ days: [] }} clientData={{}} hideReviewActions />);
    expect(screen.getByText('Nu s-a putut genera planul.')).toBeInTheDocument();
  });
});
