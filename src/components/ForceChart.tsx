import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { ForcePoint } from "../types";
import type { Theme } from "../hooks/useTheme";
import { forceText } from "../format";

interface Props {
  history: ForcePoint[];
  target: number | null;
  theme: Theme;
}

// Преобразует CSS-переменную в конкретный цвет для uPlot (который рисует на
// canvas и сам не может читать CSS-переменные). Перечитывается при смене темы.
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

/**
 * График силы во времени (uPlot): живая линия нагрузки + пунктирная линия цели.
 * Цвета берутся из CSS-переменных активной темы, поэтому график пересоздаётся
 * при переключении темы. History - это скользящий буфер из useStand.
 */
export function ForceChart({ history, target, theme }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  const data = useMemo<uPlot.AlignedData>(() => {
    const n = history.length;
    const xs = new Array<number>(n);
    const load = new Array<number | null>(n);
    const tgt = new Array<number | null>(n);
    for (let i = 0; i < n; i++) {
      xs[i] = history[i].t;
      load[i] = history[i].kg;
      tgt[i] = target;
    }
    return [xs, load, tgt];
  }, [history, target]);

  // (Пере)создание графика при монтировании и при каждой смене темы.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const accent = cssVar("--accent", "#3d8bfd");
    const warn = cssVar("--warn", "#e0a72e");
    const axis = cssVar("--muted", "#8595a1");
    const grid = cssVar("--grid-line", "rgba(255,255,255,0.05)");
    const fill = cssVar("--accent-weak", "rgba(61,139,253,0.14)");

    const opts: uPlot.Options = {
      width: host.clientWidth || 600,
      height: 240,
      scales: { x: { time: false } },
      series: [
        { label: "t", value: (_u, v) => (v == null ? "" : fmtSecs(v)) },
        {
          label: "Нагрузка",
          stroke: accent,
          width: 2,
          fill,
          value: (_u, v) => forceText(v),
        },
        {
          label: "Цель",
          stroke: warn,
          width: 1.5,
          dash: [6, 5],
          points: { show: false },
          value: (_u, v) => forceText(v),
        },
      ],
      axes: [
        {
          stroke: axis,
          grid: { stroke: grid },
          ticks: { stroke: grid },
          values: (_u, splits) => splits.map(fmtSecs),
        },
        { stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid } },
      ],
      legend: { show: true },
      cursor: { drag: { x: true, y: false } },
    };

    const plot = new uPlot(opts, data, host);
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      plot.setSize({ width: host.clientWidth || 600, height: 240 });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // Пересоздаётся при смене темы; данные подаются эффектом ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return (
    <section className="card col-12">
      <div className="title">
        <h2>Сила сжатия во времени</h2>
        <span className="hint">пунктир - целевая нагрузка</span>
      </div>
      <div className="chart-host" ref={hostRef} />
      {history.length === 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          Ожидание телеметрии от стенда…
        </div>
      )}
    </section>
  );
}

function fmtSecs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const p2 = (n: number) => (n < 10 ? "0" : "") + n;
  return `${m}:${p2(r)}`;
}
