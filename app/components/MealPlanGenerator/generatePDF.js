import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Normalize Romanian diacritics for Helvetica font ────────────────────────
function s(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/ș/g, 's').replace(/Ș/g, 'S')
    .replace(/ț/g, 't').replace(/Ț/g, 'T')
    .replace(/ă/g, 'a').replace(/Ă/g, 'A')
    .replace(/â/g, 'a').replace(/Â/g, 'A')
    .replace(/î/g, 'i').replace(/Î/g, 'I');
}

// ─── Brand Colors ─────────────────────────────────────────────────────────────
const C = {
  dark:      [18, 18, 24],
  lime:      [183, 255, 0],
  white:     [255, 255, 255],
  offWhite:  [248, 248, 250],
  lightGray: [238, 238, 243],
  midGray:   [134, 134, 139],
  darkText:  [29, 29, 31],
  border:    [218, 218, 226],
  noteYellow:[255, 250, 228],
  noteTxt:   [100, 82, 20],
};

// ─── Constants ────────────────────────────────────────────────────────────────
const PAGE_W    = 210;
const PAGE_H    = 297;
const MARGIN    = 13;
const CONTENT_W = PAGE_W - MARGIN * 2;

const DAY_NAMES = ['Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri', 'Sambata', 'Duminica'];

const GOAL_LABELS = {
  weight_loss:   'Slabit',
  muscle_gain:   'Masa musculara',
  maintenance:   'Mentinere',
  recomposition: 'Recompozitie',
};

const DIET_LABELS = {
  omnivore:   'Omnivor',
  vegetarian: 'Vegetarian',
  vegan:      'Vegan',
};

const ACTIVITY_LABELS = {
  sedentary:    'Sedentar',
  light:        'Usor activ',
  moderate:     'Moderat activ',
  very_active:  'Foarte activ',
  extra_active: 'Extrem de activ',
};

const MEAL_LABELS = {
  'Masa 1': 'Masa 1', 'Masa 2': 'Masa 2', 'Masa 3': 'Masa 3',
  'Gustare': 'Gustare', 'Gustare 1': 'Gustare 1', 'Gustare 2': 'Gustare 2',
  'Breakfast': 'Masa 1', 'Lunch': 'Masa 2', 'Dinner': 'Masa 3',
  'Snack': 'Gustare', 'Snack 1': 'Gustare 1', 'Snack 2': 'Gustare 2',
  'Mic Dejun': 'Masa 1', 'Pranz': 'Masa 2', 'Cina': 'Masa 3',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function drawDayMiniHeader(doc, dayName, clientName) {
  doc.setFillColor(...C.dark);
  doc.rect(0, 0, PAGE_W, 13, 'F');
  doc.setFillColor(...C.lime);
  doc.rect(0, 13, PAGE_W, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.lime);
  doc.text(s(dayName).toUpperCase() + ' — continuare', MARGIN, 9.5);
  if (clientName) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C.midGray);
    doc.text(s(clientName), PAGE_W - MARGIN, 9.5, { align: 'right' });
  }
}

function drawPageNumber(doc, num) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(180, 180, 188);
  doc.text(String(num), PAGE_W / 2, PAGE_H - 5, { align: 'center' });
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function generateMealPlanPDF(plan, clientData, nutritionalNeeds) {
  const doc  = new jsPDF({ unit: 'mm', format: 'a4' });
  const name = s(clientData?.name || 'Client');

  // ═════════════════════════════════════════════════════════════
  // PAGE 1 — COVER / SUMMARY
  // ═════════════════════════════════════════════════════════════

  // Dark header strip
  doc.setFillColor(...C.dark);
  doc.rect(0, 0, PAGE_W, 60, 'F');

  // Lime accent line
  doc.setFillColor(...C.lime);
  doc.rect(0, 60, PAGE_W, 2, 'F');

  // Label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.lime);
  doc.text('PLAN ALIMENTAR PERSONALIZAT', MARGIN, 22);

  // Client name (large)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(27);
  doc.setTextColor(...C.white);
  doc.text(name, MARGIN, 42);

  // Generation date
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.midGray);
  const today = new Date().toLocaleDateString('ro-RO', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  doc.text(`Generat pe ${today}  ·  Plan 7 zile`, MARGIN, 54);

  let y = 72;

  // ── Client Profile Box ──────────────────────────────────────
  if (clientData) {
    const stats = [
      { label: 'Varsta',    value: clientData.age      ? `${clientData.age} ani`      : null },
      { label: 'Greutate',  value: clientData.weight   ? `${clientData.weight} kg`    : null },
      { label: 'Inaltime',  value: clientData.height   ? `${clientData.height} cm`    : null },
      { label: 'Gen',       value: clientData.gender === 'M' ? 'Masculin' : clientData.gender === 'F' ? 'Feminin' : null },
      { label: 'Obiectiv',  value: GOAL_LABELS[clientData.goal]          || clientData.goal          || null },
      { label: 'Dieta',     value: DIET_LABELS[clientData.dietType]      || clientData.dietType      || null },
      { label: 'Activitate',value: ACTIVITY_LABELS[clientData.activityLevel] || clientData.activityLevel || null },
      { label: 'Mese/zi',   value: clientData.mealsPerDay ? `${clientData.mealsPerDay} mese` : null },
    ].filter(st => st.value && st.value !== 'undefined' && st.value !== 'null');

    const rows  = Math.ceil(stats.length / 4);
    const boxH  = 14 + rows * 17 + 6;
    const colW  = CONTENT_W / 4;

    doc.setFillColor(...C.offWhite);
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 4, 4, 'FD');

    // Section label
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.midGray);
    doc.text('PROFIL CLIENT', MARGIN + 6, y + 10);

    // Stats
    stats.forEach((stat, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const sx  = MARGIN + 6 + col * colW;
      const sy  = y + 20 + row * 17;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...C.darkText);
      doc.text(s(stat.value), sx, sy);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.midGray);
      doc.text(stat.label, sx, sy + 5.5);
    });

    y += boxH + 8;
  }

  // ── Nutritional Targets Box ────────────────────────────────
  if (nutritionalNeeds) {
    doc.setFillColor(...C.dark);
    doc.roundedRect(MARGIN, y, CONTENT_W, 48, 4, 4, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.lime);
    doc.text('NECESAR ZILNIC', MARGIN + 6, y + 12);

    const macros = [
      { label: 'kcal  Calorii',   value: String(nutritionalNeeds.calories) },
      { label: 'g  Proteine',     value: String(nutritionalNeeds.protein)  },
      { label: 'g  Carbohidrati', value: String(nutritionalNeeds.carbs)    },
      { label: 'g  Grasimi',      value: String(nutritionalNeeds.fat)      },
    ];

    const colW2 = CONTENT_W / 4;
    macros.forEach((macro, i) => {
      const sx = MARGIN + 6 + i * colW2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(...C.white);
      doc.text(macro.value, sx, y + 31);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.midGray);
      doc.text(macro.label, sx, y + 39);
    });

    y += 56;
  }

  // Cover note
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...C.midGray);
  doc.text(
    'Paginile urmatoare contin planul detaliat — cate o zi per pagina.',
    MARGIN, y + 8
  );

  drawPageNumber(doc, 1);

  // ═════════════════════════════════════════════════════════════
  // PAGES 2–8 — ONE PER DAY
  // ═════════════════════════════════════════════════════════════

  plan.days.forEach((day, dayIndex) => {
    doc.addPage();
    const dayName = DAY_NAMES[dayIndex] || `Ziua ${dayIndex + 1}`;

    // ── Day Header ──────────────────────────────────────────
    doc.setFillColor(...C.dark);
    doc.rect(0, 0, PAGE_W, 26, 'F');
    doc.setFillColor(...C.lime);
    doc.rect(0, 26, PAGE_W, 1.5, 'F');

    // Day number badge
    doc.setFillColor(...C.lime);
    doc.roundedRect(MARGIN, 7, 12, 12, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...C.dark);
    doc.text(String(dayIndex + 1), MARGIN + 6, 15.5, { align: 'center' });

    // Day name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...C.white);
    doc.text(s(dayName).toUpperCase(), MARGIN + 16, 15.5);

    // Client name (top-right)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.midGray);
    doc.text(name, PAGE_W - MARGIN, 10, { align: 'right' });

    // Macro target reminder
    if (nutritionalNeeds) {
      doc.setFontSize(7.5);
      doc.text(
        `Target: ${nutritionalNeeds.calories} kcal   P:${nutritionalNeeds.protein}g   C:${nutritionalNeeds.carbs}g   G:${nutritionalNeeds.fat}g`,
        PAGE_W - MARGIN, 19.5, { align: 'right' }
      );
    }

    let pageY = 33;

    // ── Meals ────────────────────────────────────────────────
    day.meals.forEach((meal) => {
      const mealLabel   = s(MEAL_LABELS[meal.mealType] || meal.mealType);
      const caloriesStr = meal.mealTotals ? `${meal.mealTotals.calories} kcal` : '';

      // Rough height estimate: meal-header(9) + table(7 + foods*7.5) + prep(12?) + gap(5)
      const estTableH = 7 + (meal.foods?.length || 0) * 7.5;
      const estPrepH  = meal.preparation ? 12 : 0;
      const estTotal  = 9 + estTableH + estPrepH + 5;

      // Overflow check — manual page break before meal
      if (pageY + estTotal > PAGE_H - 26 && pageY > 40) {
        doc.addPage();
        drawDayMiniHeader(doc, dayName, clientData?.name);
        pageY = 20;
      }

      // Meal type header bar
      doc.setFillColor(...C.lightGray);
      doc.roundedRect(MARGIN, pageY, CONTENT_W, 8, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...C.darkText);
      doc.text(mealLabel, MARGIN + 5, pageY + 5.5);
      if (caloriesStr) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...C.midGray);
        doc.text(caloriesStr, PAGE_W - MARGIN - 5, pageY + 5.5, { align: 'right' });
      }
      pageY += 9;

      // Foods table
      const tableBody = (meal.foods || []).map(food => [
        s(food.name),
        `${food.amount}${food.unit || 'g'}`,
        `${food.calories}`,
        `${food.protein}g`,
        `${food.carbs}g`,
        `${food.fat}g`,
      ]);

      autoTable(doc, {
        startY: pageY,
        head: [['Aliment', 'Cantitate', 'kcal', 'Proteine', 'Carboh.', 'Grasimi']],
        body: tableBody,
        margin: { left: MARGIN, right: MARGIN, top: 20 },
        styles: {
          fontSize: 8,
          cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
          font: 'helvetica',
          textColor: C.darkText,
          lineColor: C.border,
          lineWidth: 0.15,
        },
        headStyles: {
          fillColor: C.dark,
          textColor: C.lime,
          fontStyle: 'bold',
          fontSize: 7.5,
        },
        alternateRowStyles: {
          fillColor: C.offWhite,
        },
        columnStyles: {
          0: { cellWidth: 'auto'              },
          1: { cellWidth: 22, halign: 'right' },
          2: { cellWidth: 18, halign: 'right' },
          3: { cellWidth: 22, halign: 'right' },
          4: { cellWidth: 22, halign: 'right' },
          5: { cellWidth: 22, halign: 'right' },
        },
        tableWidth: CONTENT_W,
        theme: 'plain',
        didDrawPage: (data) => {
          if (data.pageNumber > 1) {
            drawDayMiniHeader(doc, dayName, clientData?.name);
          }
        },
      });

      pageY = doc.lastAutoTable.finalY + 3;

      // Preparation note
      if (meal.preparation) {
        const prepText = s('Preparare: ' + meal.preparation);
        const lines    = doc.splitTextToSize(prepText, CONTENT_W - 10);
        const noteH    = lines.length * 4.5 + 6;

        if (pageY + noteH > PAGE_H - 26) {
          doc.addPage();
          drawDayMiniHeader(doc, dayName, clientData?.name);
          pageY = 20;
        }

        doc.setFillColor(...C.noteYellow);
        doc.roundedRect(MARGIN, pageY, CONTENT_W, noteH, 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(...C.noteTxt);
        lines.forEach((line, li) => {
          doc.text(line, MARGIN + 5, pageY + 5 + li * 4.5);
        });
        pageY += noteH + 5;
      } else {
        pageY += 5;
      }
    });

    // ── Daily Totals Footer ──────────────────────────────────
    if (day.dailyTotals) {
      let totY = pageY + 4;
      if (totY + 13 > PAGE_H - 6) {
        doc.addPage();
        drawDayMiniHeader(doc, dayName, clientData?.name);
        totY = 22;
      }

      doc.setFillColor(...C.dark);
      doc.roundedRect(MARGIN, totY, CONTENT_W, 13, 3, 3, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.midGray);
      doc.text('TOTAL ZI', MARGIN + 6, totY + 8.5);

      const t      = day.dailyTotals;
      const totStr = `${t.calories} kcal   P: ${t.protein}g   C: ${t.carbs}g   G: ${t.fat}g`;
      doc.setFontSize(9);
      doc.setTextColor(...C.lime);
      doc.text(totStr, PAGE_W - MARGIN - 6, totY + 8.5, { align: 'right' });
    }

    drawPageNumber(doc, dayIndex + 2);
  });

  // ── Save ────────────────────────────────────────────────────
  const filename = `plan-alimentar-${s(clientData?.name || 'client').replace(/\s+/g, '-').toLowerCase()}.pdf`;
  doc.save(filename);
}
