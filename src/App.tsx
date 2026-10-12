import { useCallback, useEffect, useRef, useState } from "react";
import { clearStoredHost, defaultHost, resolveHost, setStoredHost } from "./config";
import { useStand, type LogEntry } from "./hooks/useStand";
import { useTheme } from "./hooks/useTheme";
import { useCoordinator } from "./coord/useCoordinator";
import type { Command } from "./types";
import { Header } from "./components/Header";
import { LockBar } from "./components/LockBar";
import { Toasts } from "./components/Toasts";
import { LogArchive } from "./components/LogArchive";
import { ControlsCard } from "./components/ControlsCard";
import { StatusCard } from "./components/StatusCard";
import { AngleDial } from "./components/AngleDial";
import { ForceCard } from "./components/ForceCard";
import { TargetRangeCard } from "./components/TargetRangeCard";
import { ForceChart } from "./components/ForceChart";
import { EventLog } from "./components/EventLog";

export default function App() {
  const { theme, toggle } = useTheme();
  const [host, setHost] = useState<string>(() => resolveHost());
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Канал управления + серверный журнал. Записи общего журнала (кто что сделал)
  // попадают в экранный журнал через noteRef - useStand создаётся ниже.
  const noteRef = useRef<(kind: LogEntry["kind"], text: string) => void>(() => {});
  const coord = useCoordinator(host, (kind, text) => noteRef.current(kind, text));
  const { status, telemetry, history, log, send, sendConfig, note } = useStand(host, coord.observer);
  noteRef.current = note;

  // Истинно, пока карточка target/range держит правки, ещё не применённые к стенду.
  // Блокирует SEEK-в-HOLD, чтобы повторный поиск не нацелился на значение, которое
  // оператор ввёл, но не отправил. Сбрасывается при смене host: TargetRangeCard
  // перемонтируется (key={host}) и теряет собственный dirty-ref, поэтому это
  // зеркало на уровне App тоже нужно очищать здесь.
  const [configDirty, setConfigDirty] = useState(false);

  const applyHost = useCallback((next: string) => {
    const h = next.trim();
    if (!h) return;
    setStoredHost(h);
    setHost(h);
    setConfigDirty(false);
  }, []);

  const resetHost = useCallback(() => {
    clearStoredHost();
    setHost(defaultHost());
    setConfigDirty(false);
  }, []);

  // Связь этой панели со стендом - в серверный журнал (диагностика «у кого не
  // подключалось»).
  const { reportConn, reportCmd, reportConfig, gate } = coord;
  const wasConnected = useRef(false);
  useEffect(() => {
    const connected = status === "connected";
    if (connected !== wasConnected.current) {
      wasConnected.current = connected;
      reportConn(connected);
    }
  }, [status, reportConn]);

  // Команды и параметры уходят на стенд только от владельца канала; каждое
  // действие пишется в серверный журнал и продлевает владение.
  const guardedSend = useCallback(
    (cmd: Command) => {
      if (!gate.allowed) return;
      send(cmd);
      reportCmd(`команда ${cmd.toUpperCase()}`);
    },
    [gate.allowed, send, reportCmd],
  );

  const guardedConfig = useCallback(
    async (target: number, min: number, max: number) => {
      if (!gate.allowed) return null;
      const res = await sendConfig(target, min, max);
      reportConfig(
        !!res?.applied,
        res?.applied
          ? `параметры применены: target=${res.applied.target} min=${res.applied.min} max=${res.applied.max}`
          : `параметры отклонены стендом (target=${target} min=${min} max=${max}): ${res?.error ?? "нет ответа"}${res?.detail ? ` - ${res.detail}` : ""}`,
      );
      return res;
    },
    [gate.allowed, sendConfig, reportConfig],
  );

  const state = telemetry?.state ?? null;

  return (
    <div className="app">
      <Header
        host={host}
        status={status}
        theme={theme}
        onApplyHost={applyHost}
        onResetHost={resetHost}
        onToggleTheme={toggle}
      />

      <div className="grid">
        {/* Ряд 0: канал управления - кто управляет стендом */}
        <LockBar coord={coord} />

        {/* Ряд 1: статус, усилие, угол */}
        <StatusCard telemetry={telemetry} />
        <ForceCard telemetry={telemetry} />
        <AngleDial telemetry={telemetry} />

        {/* Ряд 2: управление, target/range */}
        <ControlsCard state={state} onCommand={guardedSend} telemetry={telemetry} configDirty={configDirty} gate={gate} />
        {/* key={host}: перемонтирование при смене стенда, чтобы карточка конфигурации
            заново взяла начальные значения из телеметрии нового стенда, а не держала
            значения старого. */}
        <TargetRangeCard
          key={host}
          telemetry={telemetry}
          onApply={guardedConfig}
          onDirtyChange={setConfigDirty}
          gate={gate}
        />

        {/* Ряд 3: график, во всю ширину */}
        <ForceChart history={history} target={telemetry?.target_kg ?? null} theme={theme} />

        {/* Ряд 4: журнал, во всю ширину */}
        <EventLog
          log={log}
          actions={
            <button className="chip small" onClick={() => setArchiveOpen(true)}>
              Архив журналов
            </button>
          }
        />
      </div>

      {archiveOpen && <LogArchive onClose={() => setArchiveOpen(false)} />}
      <Toasts toasts={coord.toasts} onDismiss={coord.dismissToast} />
    </div>
  );
}
