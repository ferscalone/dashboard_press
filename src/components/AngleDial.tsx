import type { Telemetry } from "../types";

interface Props {
  telemetry: Telemetry | null;
}

const SIZE = 168;
const R = 68;
const CX = SIZE / 2;
const CY = SIZE / 2;

// Логический ноль (домашняя позиция) находится СПРАВА (на 3 часа): 0°
// соответствует правой стороне окружности. Положительный относительный угол
// вращается против часовой стрелки (вверх по экрану); y инвертируется, потому
// что в SVG ось y растёт вниз.
function pointAt(deg: number, r = R): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) };
}

export function AngleDial({ telemetry }: Props) {
  const rel = telemetry?.encoder_rel_deg ?? null;
  const abs = telemetry?.encoder_abs_deg ?? null;
  const fault = telemetry ? telemetry.encoder_fault === 1 : false;

  const has = rel !== null;
  const dot = pointAt(rel ?? 0);
  const home = pointAt(0);
  const tickO = pointAt(0, R + 8);
  const tickI = pointAt(0, R - 8);
  const dotColor = fault ? "var(--danger)" : "var(--accent)";

  return (
    <section className="card col-4">
      <div className="title">
        <h2>Угол отклонения</h2>
      </div>
      <div className="dial-grid">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--border-2)" strokeWidth="7" />

          {/* засечка логического нуля СПРАВА */}
          <line x1={tickI.x} y1={tickI.y} x2={tickO.x} y2={tickO.y}
                stroke="var(--muted)" strokeWidth="2.5" strokeLinecap="round" />

          {/* дуга от домашней позиции → к текущей */}
          {has && Math.abs(rel as number) > 0.5 && (
            <path d={arcPath(0, rel as number)} fill="none"
                  stroke="var(--accent)" strokeWidth="7" strokeLinecap="round" opacity="0.6" />
          )}

          <circle cx={home.x} cy={home.y} r={3} fill="var(--muted)" />
          {has && <circle cx={dot.x} cy={dot.y} r={7} fill={dotColor} />}

          <text
            x={CX} y={CY + 7} textAnchor="middle" fontSize="26"
            fontWeight={has ? 800 : 300}
            fill={has ? "var(--text-hi)" : "var(--faint)"}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {has ? `${(rel as number).toFixed(1)}°` : "–"}
          </text>
        </svg>

        <div className="dial-diag">
          <div className="diag-item">
            <div className="k">Отн. дома</div>
            <div className="v num">
              {has ? `${(rel as number).toFixed(1)}°` : <span className="empty">–</span>}
            </div>
          </div>
          <div className="diag-item">
            <div className="k">Абс. угол · AS5600</div>
            <div className="v num">
              {abs !== null ? <>{abs.toFixed(2)}°<span className="sub">ноль ≈ 106°</span></> : <span className="empty">–</span>}
            </div>
          </div>
          <div className="diag-item">
            <div className="k">Энкодер</div>
            <div className="v">
              {telemetry
                ? <span className={`tag ${fault ? "fault" : "ok"}`}>{fault ? "ошибка" : "норма"}</span>
                : <span className="empty">–</span>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function arcPath(fromDeg: number, toDeg: number): string {
  const a = pointAt(fromDeg);
  const b = pointAt(toDeg);
  const delta = toDeg - fromDeg;
  const largeArc = Math.abs(delta) > 180 ? 1 : 0;
  const sweep = delta >= 0 ? 0 : 1; // угол против часовой стрелки → SVG sweep 0
  return `M ${a.x} ${a.y} A ${R} ${R} 0 ${largeArc} ${sweep} ${b.x} ${b.y}`;
}
