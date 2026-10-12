import { useEffect, useState, type ReactNode } from "react";
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
 * кулачков; запуск - только через диалог подтверждения с выбором направления, во
 * время калибровки на её месте кнопка STOP). RE-TARE - перезахват нуля
 * тензодатчика. Подпись кнопки - это реальный токен прошивки (SEEK_LOAD / HOMING
 * / RETURN_HOME / RE-TARE); рядом располагается русская расшифровка или причина
 * блокировки. При блокировке показывается почему - оператору не приходится
 * гадать. Строки поровну делят высоту карточки, а текст причины ограничен по
 * высоте, поэтому более длинная причина блокировки никогда не смещает соседние
 * кнопки. RE-TARE зависит от телеметрии `tare_ok` (собственный вердикт защиты
 * прошивки), поэтому активируется только в логическом нуле.
 */
export function ControlsCard({ state, onCommand, telemetry, configDirty, gate }: Props) {
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

  // Калибровка нуля кулачков. Запуск - только через диалог (защита от случайного
  // нажатия); во время калибровки строка превращается в кнопку STOP.
  const calibrating = state === "CALIBRATE";
  const calib = gated(calibAvailability(telemetry), gate);
  const calibStop = gated(
    {
      enabled: true,
      command: "stop",
      token: "STOP",
      gloss: "Кулачки в нуле - остановить",
      reason: "",
    },
    gate,
  );
  const [calibDialog, setCalibDialog] = useState(false);
  // Диалог не должен пережить условия запуска: состояние ушло из IDLE/ERROR,
  // пропала связь или право управления перешло к другому.
  useEffect(() => {
    if (calibDialog && !calib.enabled) setCalibDialog(false);
  }, [calibDialog, calib.enabled]);

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
            readyText="Текущий угол станет новым нулём"
          />
        ) : (
          <ControlRow
            avail={calib}
            icon={locked ? <LockedIcon /> : <CalibIcon />}
            secondary
            onClick={() => calib.enabled && setCalibDialog(true)}
            readyText={
              typeof telemetry?.home_abs_deg === "number"
                ? `Текущий ноль: ${telemetry.home_abs_deg.toFixed(2)}°`
                : undefined
            }
          />
        )}
      </div>
      {calibDialog && (
        <CalibDialog
          onClose={() => setCalibDialog(false)}
          onStart={(cmd) => {
            setCalibDialog(false);
            onCommand(cmd);
          }}
        />
      )}
    </section>
  );
}

/**
 * Подтверждение запуска калибровки нуля кулачков. Вращение начинается только после
 * явного выбора направления здесь; фокус по умолчанию стоит на «Отмена», поэтому
 * случайный Enter/пробел ничего не запускает. Esc и щелчок мимо окна закрывают его.
 */
function CalibDialog({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: (cmd: Command) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card calib-modal" role="dialog" aria-modal="true" aria-label="Калибровка нуля кулачков">
        <div className="title">
          <h2>Калибровка нуля кулачков</h2>
          <button className="chip" onClick={onClose} autoFocus>
            Отмена
          </button>
        </div>
        <p>
          Кулачки начнут <b>медленно вращаться</b> и не остановятся сами. Когда они встанут
          в ноль, нажмите <b>STOP</b> на панели или кнопку на стенде - текущее положение
          будет сохранено как новый ноль.
        </p>
        <p>Убедитесь, что в зоне кулачков нет рук и посторонних предметов.</p>
        <div className="calib-dirs">
          <div>
            <button className="ctl-btn" onClick={() => onStart("calib_plus")}>
              Вращать «+»
            </button>
            <div className="calib-dir-hint">в сторону поджатия платы</div>
          </div>
          <div>
            <button className="ctl-btn secondary" onClick={() => onStart("calib_minus")}>
              Вращать «−»
            </button>
            <div className="calib-dir-hint">от платы</div>
          </div>
        </div>
      </div>
    </div>
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
