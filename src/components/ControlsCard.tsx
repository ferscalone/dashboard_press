import type { ReactNode } from "react";
import type { Command, StandState, Telemetry } from "../types";
import {
  calibAvailability,
  homingAvailability,
  seekAvailability,
  tareAvailability,
  type Availability,
} from "../standLogic";
import type { Gate } from "../coord/useCoordinator";
import { gated, LockedIcon, LockTag } from "./LockTag";

interface Props {
  state: StandState | null;
  onCommand: (cmd: Command) => void;
  /** Полная телеметрия - элемент перетарирования зависит от `tare_ok`/`load_offset`. */
  telemetry: Telemetry | null;
  /** True, пока у карточки цели/диапазона есть изменения, не применённые к стенду. */
  configDirty?: boolean;
  /** Право управления (канал). Без права кнопки заблокированы с пояснением, кто управляет. */
  gate: Gate;
  /** Открыть окно входа в режим калибровки нуля кулачков. */
  onCalibrate: () => void;
}

const SeekIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20V8" />
    <path d="M8 12l4-4 4 4" />
    <path d="M5 4h14" />
  </svg>
);
const HomeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v9h14v-9" />
  </svg>
);
// Перекрестие - "перезахват нуля" тензодатчика.
const TareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2v4" />
    <path d="M12 18v4" />
    <path d="M2 12h4" />
    <path d="M18 12h4" />
  </svg>
);

// Поворот - "калибровка нуля кулачков".
const CalibIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v5h-5" />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
);
const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

/**
 * Четыре элемента управления: SEEK, HOMING, RE-TARE и CALIBRATE (калибровка нуля
 * кулачков; вход - только по логину и паролю, во время калибровки на её месте
 * кнопка STOP, а управление - на панели калибровки). RE-TARE - перезахват нуля
 * тензодатчика. Подпись кнопки - это реальный токен прошивки (SEEK_LOAD / HOMING
 * / RETURN_HOME / RE-TARE); рядом располагается русская расшифровка или причина
 * блокировки. При блокировке показывается почему - оператору не приходится
 * гадать. Строки поровну делят высоту карточки, а текст причины ограничен по
 * высоте, поэтому более длинная причина блокировки никогда не смещает соседние
 * кнопки. RE-TARE зависит от телеметрии `tare_ok` (собственный вердикт защиты
 * прошивки), поэтому активируется только в логическом нуле.
 */
export function ControlsCard({ state, onCommand, telemetry, configDirty, gate, onCalibrate }: Props) {
  let seek = seekAvailability(state);
  const homing = gated(homingAvailability(state), gate);
  const tare = gated(tareAvailability(telemetry), gate);

  // Повторный seek из HOLD должен нацеливаться на ПРИМЕНЁННОЕ значение. Пока
  // карточка цели/диапазона содержит неприменённые изменения, SEEK в HOLD
  // блокируется, а оператору предлагается сначала применить их - иначе повторный
  // seek гнался бы за старой целью стенда, тогда как карточка показывает новую.
  // (Блокировка размещена здесь, а не в standLogic, потому что "неприменённые
  // изменения" - это забота UI, а не состояния стенда.)
  if (state === "HOLD_LOAD" && seek.enabled && configDirty) {
    seek = { ...seek, enabled: false, command: null, reason: "Сначала примените изменения диапазона" };
  }
  seek = gated(seek, gate);
  const locked = !gate.allowed;

  // Калибровка нуля кулачков. Вход - через окно логина/пароля; во время калибровки
  // строка превращается в кнопку STOP (остановить движение, без входа).
  const calibrating = state === "CALIBRATE";
  const calib = gated(calibAvailability(telemetry), gate);
  const calibStop = gated(
    {
      enabled: telemetry?.calib_busy === 1,
      command: "stop",
      token: "STOP",
      gloss: "Остановить движение кулачков",
      reason: "Кулачки стоят - управление на панели калибровки",
    },
    gate,
  );

  return (
    <section className="card col-5 controls-card">
      <div className="title">
        <h2>Управление</h2>
        <LockTag gate={gate} />
      </div>
      <div className="controls">
        <ControlRow avail={seek} icon={locked ? <LockedIcon /> : <SeekIcon />} onClick={() => seek.command && onCommand(seek.command)} />
        <ControlRow avail={homing} icon={locked ? <LockedIcon /> : <HomeIcon />} secondary onClick={() => homing.command && onCommand(homing.command)} />
        <ControlRow
          avail={tare}
          icon={locked ? <LockedIcon /> : <TareIcon />}
          secondary
          onClick={() => tare.command && onCommand(tare.command)}
          // В активном состоянии заменяет общую строку "готово" на текущий ноль,
          // чтобы оператор видел текущее смещение нуля перед перетарированием.
          readyText={
            typeof telemetry?.load_offset === "number"
              ? `Текущий ноль: ${telemetry.load_offset}`
              : undefined
          }
        />
        {calibrating ? (
          <ControlRow
            avail={calibStop}
            icon={locked ? <LockedIcon /> : <StopIcon />}
            stop
            onClick={() => calibStop.command && onCommand(calibStop.command)}
            readyText="Ноль сохраняется на панели калибровки"
          />
        ) : (
          <ControlRow
            avail={calib}
            icon={locked ? <LockedIcon /> : <CalibIcon />}
            secondary
            onClick={() => calib.enabled && onCalibrate()}
            readyText={
              typeof telemetry?.home_abs_deg === "number"
                ? `Текущий ноль: ${telemetry.home_abs_deg.toFixed(2)}°`
                : undefined
            }
          />
        )}
      </div>
    </section>
  );
}

function ControlRow({
  avail,
  icon,
  secondary,
  stop,
  onClick,
  readyText,
}: {
  avail: Availability;
  icon: ReactNode;
  secondary?: boolean;
  /** Кнопка STOP калибровки - выделяется как «опасная». */
  stop?: boolean;
  onClick: () => void;
  /** Переопределяет строку "Готово к запуску", когда элемент управления активен. */
  readyText?: string;
}) {
  return (
    <div className="control">
      <button
        className={`ctl-btn ${secondary ? "secondary" : ""} ${stop ? "stop" : ""}`}
        disabled={!avail.enabled}
        onClick={onClick}
        title={avail.enabled ? avail.gloss : avail.reason}
      >
        {icon}
        {avail.token}
      </button>
      <div className="ctl-meta">
        <div className="name">{avail.gloss}</div>
        <div className="why">
          {avail.enabled ? (readyText ?? "Готово к запуску") : avail.reason}
        </div>
      </div>
    </div>
  );
}
