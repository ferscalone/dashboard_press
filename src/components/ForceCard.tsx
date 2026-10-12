import type { Telemetry } from "../types";
import { formatForce } from "../format";

interface Props {
  telemetry: Telemetry | null;
}

/** Сила, которую сейчас видит тензодатчик (HX711): load_kg, а также raw и цель. */
export function ForceCard({ telemetry }: Props) {
  const kg = telemetry?.load_kg ?? null;
  const target = telemetry?.target_kg ?? null;
  const raw = telemetry?.load_raw ?? null;

  const main = formatForce(kg);

  return (
    <section className="card col-4 stretch">
      <div className="title">
        <h2>Сила сжатия</h2>
      </div>

      <div className="force">
        <span className="group">
          {main ? (
            <>
              <span className="val num">{main.value}</span>
              <span className="unit">{main.unit}</span>
            </>
          ) : (
            // Нет данных: показывается только заглушка, без единицы измерения.
            <span className="val empty">–</span>
          )}
        </span>
      </div>

      <div className="meta-list">
        <div className="row">
          <span>Цель</span>
          {renderForce(target)}
        </div>
        <div className="row">
          <span>RAW</span>
          {raw !== null ? (
            <span className="val num">{raw}</span>
          ) : (
            <span className="val empty">–</span>
          )}
        </div>
      </div>
    </section>
  );
}

/** Выровненное по правому краю "значение единица" (или просто заглушка en-dash) для строки метаданных. */
function renderForce(kg: number | null) {
  const f = formatForce(kg);
  if (!f) return <span className="val empty">–</span>;
  return (
    <span className="val num">
      {f.value} {f.unit}
    </span>
  );
}
