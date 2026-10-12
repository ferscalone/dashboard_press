// Формы JSON, отправляемые прошивкой. Зеркалирует Telemetry.cpp:
//   buildTelemetryJson()  → Telemetry
//   buildEventJson()      → StandEvent
// Имена/типы полей в точности соответствуют тому, что шлёт устройство; не
// переименовывать их.

/** Машина состояний прошивки (SystemState.h). */
export type StandState =
  | "BOOT"
  | "HOMING"
  | "IDLE"
  | "SEEK_LOAD"
  | "HOLD_LOAD"
  | "RETURN_HOME"
  | "CALIBRATE"
  | "ERROR";

/** Периодический кадр телеметрии (~5 Гц по WS; также GET /v1/status). */
export interface Telemetry {
  state: StandState;
  load_kg: number;
  target_kg: number;
  range_min_kg: number;
  range_max_kg: number;
  load_raw: number;
  load_ready: number; // 0 | 1
  uptime_ms: number;
  encoder_abs_deg: number;
  encoder_rel_deg: number;
  encoder_fault: number; // 0 | 1
  // Перетарирование нуля тензодатчика. load_offset - текущий оперативный ноль
  // HX711 (сырые отсчёты); tare_ok равно 1, когда перетарирование было бы принято
  // прямо сейчас (IDLE + вал в логическом нуле + датчик готов + |load| ≤ 50 г).
  // Необязательные, чтобы старая прошивка без этих полей всё равно проходила
  // проверку типов.
  load_offset?: number;
  tare_ok?: number; // 0 | 1
  // Действующий домашний угол (логический ноль), абс. градусы AS5600. Задаётся
  // калибровкой нуля кулачков. Необязательное: его наличие заодно означает, что
  // прошивка поддерживает калибровку (старая прошивка поле не присылает).
  home_abs_deg?: number;
}

/** Кадр мгновенного дискретного события (смена состояния / park / ошибка / ack команды / tare). */
export interface StandEvent {
  event: "state" | "park" | "error" | "wall" | "ack" | "tare" | "calib";
  // Для "ack": "<CMD>:ok" или "<CMD>:ignored_<STATE|reason>" (см. onCommand прошивки).
  // Для "tare": "off=<new> prev=<old>" (сырые отсчёты) при успешном перетарировании.
  // Для "calib": "home=<new> prev=<old>" (градусы) при принятом нуле, либо
  // "cancelled" / "aborted_travel" / "aborted_load".
  detail: string;
  uptime_ms: number;
}

/** Тело ответа для POST /v1/config. */
export interface ConfigApplyResponse {
  applied?: { target: number; min: number; max: number };
  error?: string;
  detail?: string;
}

/** Текстовые кадры команд, понимаемые прошивкой. */
export type Command = "seek" | "home" | "stop" | "tare" | "calib_plus" | "calib_minus";

/** Жизненный цикл WebSocket-соединения для индикатора в шапке. */
export type ConnStatus = "connected" | "reconnecting" | "disconnected";

/** Одна выборочная точка для графика усилия по времени. */
export interface ForcePoint {
  t: number; // секунды по часам клиента (ось X uPlot)
  kg: number;
}

export function isTelemetry(m: unknown): m is Telemetry {
  return (
    typeof m === "object" &&
    m !== null &&
    "state" in m &&
    "load_kg" in m
  );
}

export function isEvent(m: unknown): m is StandEvent {
  return typeof m === "object" && m !== null && "event" in m;
}
