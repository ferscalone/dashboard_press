import type { Telemetry } from "../types";
import { stateMeta } from "../standLogic";

interface Props {
  telemetry: Telemetry | null;
}

export function StatusCard({ telemetry }: Props) {
  const state = telemetry?.state ?? null;
  const meta = stateMeta(state);
  const ready = telemetry ? telemetry.load_ready === 1 : false;

  return (
    <section className="card col-4 stretch">
      <div className="title">
        <h2>Статус</h2>
      </div>

      <div className="status-main">
        <div className="status-name">{meta.label}</div>
      </div>

      <div className="meta-list">
        <div className="row">
          <span>Датчик</span>
          {telemetry ? (
            <span className={`tag ${ready ? "ok" : ""}`}>
              {ready ? "готов" : "нет сэмпла"}
            </span>
          ) : (
            <span className="val empty">–</span>
          )}
        </div>
        {typeof telemetry?.motor_en === "number" && (
          <div className="row">
            <span>Мотор</span>
            <span className={`tag ${telemetry.motor_en === 1 ? "ok" : ""}`}>
              {telemetry.motor_en === 1 ? "включён" : "отключён · нет нагрузки"}
            </span>
          </div>
        )}
        <div className="row">
          <span>Аптайм</span>
          {telemetry ? (
            <span className="val num">{fmtUptime(telemetry.uptime_ms)}</span>
          ) : (
            <span className="val empty">–</span>
          )}
        </div>
      </div>
    </section>
  );
}

function fmtUptime(ms: number): string {
  let s = Math.floor(Number(ms) / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const p2 = (n: number) => (n < 10 ? "0" : "") + n;
  if (h > 0) return `${h}ч ${p2(m)}м ${p2(s)}с`;
  if (m > 0) return `${m}м ${p2(s)}с`;
  return `${s}с`;
}
