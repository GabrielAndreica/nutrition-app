// generateWorkoutPDF.js — Workout plan PDF generator (same template as meal plan PDF)

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

// ─── Brand Colors (identical to meal plan PDF) ────────────────────────────────
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

const FITNESS_GOAL_LABELS = {
  'muscle gain':  'Masa musculara',
  'weight loss':  'Slabit',
  'muscle_gain':  'Masa musculara',
  'weight_loss':  'Slabit',
  maintenance:    'Mentinere',
  strength:       'Forta',
  endurance:      'Rezistenta',
};

const FITNESS_LEVEL_LABELS = {
  beginner:     'Incepator',
  intermediate: 'Intermediar',
  advanced:     'Avansat',
};

const ACTIVITY_LABELS = {
  sedentary:    'Sedentar',
  light:        'Usor activ',
  moderate:     'Moderat activ',
  very_active:  'Foarte activ',
  extra_active: 'Extrem de activ',
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

export async function generateWorkoutPlanPDF(plan, clientData) {
  const { default: jsPDF }     = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc  = new jsPDF({ unit: 'mm', format: 'a4' });
  const name = s(clientData?.name || plan?.clientName || 'Client');

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
  doc.text('PLAN DE ANTRENAMENT PERSONALIZAT', MARGIN, 22);

  // Client name (large)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(27);
  doc.setTextColor(...C.white);
  doc.text(name, MARGIN, 42);

  const workoutDays = (plan.days || []).filter(d => !d.isRestDay);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.midGray);
  doc.text(`${workoutDays.length} antrenamente/sapt`, MARGIN, 54);

  let y = 72;

  // ── Client Profile Box ──────────────────────────────────────
  {
    const stats = [
      { label: 'Varsta',    value: clientData?.age      ? `${clientData.age} ani`      : null },
      { label: 'Greutate',  value: clientData?.weight   ? `${clientData.weight} kg`    : null },
      { label: 'Inaltime',  value: clientData?.height   ? `${clientData.height} cm`    : null },
      { label: 'Gen',       value: clientData?.gender === 'M' ? 'Masculin' : clientData?.gender === 'F' ? 'Feminin' : null },
      { label: 'Obiectiv',  value: FITNESS_GOAL_LABELS[plan?.fitnessGoal || clientData?.fitnessGoal] || s(plan?.fitnessGoal) || null },
      { label: 'Nivel',     value: FITNESS_LEVEL_LABELS[plan?.fitnessLevel || clientData?.fitnessLevel] || s(plan?.fitnessLevel) || null },
      { label: 'Activitate',value: ACTIVITY_LABELS[clientData?.activity_level || clientData?.activityLevel] || s(clientData?.activity_level) || null },
      { label: 'Split',     value: s(plan?.split || clientData?.training_split || clientData?.trainingSplit) || null },
    ].filter(st => st.value && st.value !== 'undefined' && st.value !== 'null');

    if (stats.length > 0) {
      const rows  = Math.ceil(stats.length / 4);
      const boxH  = 14 + rows * 17 + 6;
      const colW  = CONTENT_W / 4;

      doc.setFillColor(...C.offWhite);
      doc.setDrawColor(...C.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 4, 4, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.midGray);
      doc.text('PROFIL CLIENT', MARGIN + 6, y + 10);

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
  }

  // ── Workout Summary Box ────────────────────────────────────
  {
    const totalExercises = workoutDays.reduce((n, d) => n + (d.exercises || []).length, 0);
    const summaryItems = [
      { label: 'Antrenamente/sapt', value: String(plan?.workoutsPerWeek || workoutDays.length) },
      { label: 'Total exercitii',   value: String(totalExercises) },
      { label: 'Echipament',        value: s(plan?.equipment || clientData?.availableEquipment) || null },
      { label: 'Limitari',          value: s(clientData?.injuriesLimitations) || null },
    ].filter(st => st.value && st.value !== 'undefined' && st.value !== 'null');

    doc.setFillColor(...C.dark);
    doc.roundedRect(MARGIN, y, CONTENT_W, 48, 4, 4, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.lime);
    doc.text('SUMAR ANTRENAMENT', MARGIN + 6, y + 12);

    const colW2 = CONTENT_W / 4;
    summaryItems.slice(0, 4).forEach((stat, i) => {
      const sx = MARGIN + 6 + i * colW2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(i < 2 ? 22 : 10);
      doc.setTextColor(...C.white);
      const val = s(stat.value);
      doc.text(val, sx, y + 31);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.midGray);
      doc.text(stat.label, sx, y + 39);
    });

    y += 56;
  }

  // General notes
  if (plan?.generalNotes) {
    const noteLines = doc.splitTextToSize(s(plan.generalNotes), CONTENT_W - 10);
    const noteH     = noteLines.length * 4.5 + 6;
    doc.setFillColor(...C.noteYellow);
    doc.roundedRect(MARGIN, y, CONTENT_W, noteH, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.noteTxt);
    noteLines.forEach((line, li) => doc.text(line, MARGIN + 5, y + 5 + li * 4.5));
    y += noteH + 6;
  }

  drawPageNumber(doc, 1);

  // ═════════════════════════════════════════════════════════════
  // PAGES 2+ — ONE PER DAY
  // ═════════════════════════════════════════════════════════════

  (plan.days || []).forEach((day, dayIndex) => {
    doc.addPage();
    const dayName = s(day.dayName || `Ziua ${dayIndex + 1}`);

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
    doc.text(dayName.toUpperCase(), MARGIN + 16, 15.5);

    // Client name top-right
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.midGray);
    doc.text(name, PAGE_W - MARGIN, 10, { align: 'right' });

    // Duration top-right second line
    if (!day.isRestDay && day.estimatedDuration) {
      doc.setFontSize(7.5);
      doc.text(`~${day.estimatedDuration} min`, PAGE_W - MARGIN, 19.5, { align: 'right' });
    }

    let pageY = 33;

    // ── Rest day ─────────────────────────────────────────────
    if (day.isRestDay) {
      doc.setFillColor(...C.lightGray);
      const restMsg   = s(day.message || 'Zi de odihna — recuperare activa: stretching usor, mers pe jos.');
      const restLines = doc.splitTextToSize(restMsg, CONTENT_W - 10);
      const restH     = restLines.length * 5 + 10;
      doc.roundedRect(MARGIN, pageY, CONTENT_W, restH, 3, 3, 'F');
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(...C.midGray);
      restLines.forEach((line, li) => doc.text(line, MARGIN + 5, pageY + 7 + li * 5));
      drawPageNumber(doc, dayIndex + 2);
      return;
    }

    // ── Session name ─────────────────────────────────────────
    if (day.sessionName) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...C.darkText);
      doc.text(s(day.sessionName), MARGIN, pageY + 5);
      pageY += 10;
    }

    // ── Exercises table ───────────────────────────────────────
    if ((day.exercises || []).length) {
      autoTable(doc, {
        startY: pageY,
        head: [['#', 'Exercitiu', 'Grupe musculare', 'Seturi', 'Repetari']],
        body: (day.exercises || []).map((ex, i) => [
          String(ex.order || i + 1),
          s(ex.name),
          s(ex.muscleGroup || ex.muscle_group || ''),
          String(ex.sets || ''),
          String(ex.reps || ''),
        ]),
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
          0: { cellWidth: 8                  },
          1: { cellWidth: 'auto'             },
          2: { cellWidth: 40                 },
          3: { cellWidth: 16, halign: 'right'},
          4: { cellWidth: 20, halign: 'right'},
        },
        tableWidth: CONTENT_W,
        theme: 'plain',
        didDrawPage: (data) => {
          if (data.pageNumber > 1) {
            drawDayMiniHeader(doc, dayName, name);
          }
        },
      });
      pageY = doc.lastAutoTable.finalY + 5;
    }

    drawPageNumber(doc, dayIndex + 2);
  });

  // ── Save ────────────────────────────────────────────────────
  const filename = `plan-antrenament-${s(name).replace(/\s+/g, '-').toLowerCase()}.pdf`;
  doc.save(filename);
}
