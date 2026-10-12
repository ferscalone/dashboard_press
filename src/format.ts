// Форматирование усилия, общее для карточек и графика.
//
// Правило (по запросу оператора):
//   - нет данных (null)   → вернуть null; вызывающая сторона рисует одиночное тире
//                           и БЕЗ единицы (чтобы пустое показание не помечалось "кг").
//   - |load| >= 1 кг      → килограммы, "кг", 3 знака после запятой.
//   - |load| <  1 кг      → граммы, "г", целые граммы.
//
// Порог использует абсолютное значение, чтобы небольшой отрицательный шум
// (например, -0.004) всё равно читался в граммах, а не переключался на кг.

export interface Force {
  value: string;
  unit: string;
}

export function formatForce(kg: number | null | undefined): Force | null {
  if (kg == null || !isFinite(kg)) return null;
  if (Math.abs(kg) >= 1) {
    return { value: kg.toFixed(3), unit: "кг" };
  }
  return { value: Math.round(kg * 1000).toString(), unit: "г" };
}

/** Компактная строка "значение единица" или "–", когда данных нет. */
export function forceText(kg: number | null | undefined): string {
  const f = formatForce(kg);
  return f ? `${f.value} ${f.unit}` : "–";
}
