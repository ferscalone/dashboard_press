import type { Command, StandState, Telemetry } from "./types";

// ── Управление: SEEK_LOAD + HOMING как два независимых действия ──────────────
// Firmware API: три явные команды, эффект которых не зависит от состояния
// (NetworkManager::onCommand):
//
//   seek : IDLE            → SEEK_LOAD          (иначе игнорируется)
//          HOLD_LOAD       → повторный поиск к последним ПРИМЕНЁННЫМ target/range
//   home : SEEK_LOAD/HOLD  → RETURN_HOME
//          ERROR/IDLE      → повторный homing   (идемпотентно из IDLE)
//   stop : SEEK_LOAD       → HOLD_LOAD (заморозка) (иначе игнор.; диагностика)
//
// Две кнопки (SEEK, HOMING) соответствуют seek/home. seek-из-HOLD выполняет
// повторный поиск от ТЕКУЩЕЙ нагрузки к последним ПРИМЕНЁННЫМ target/range без
// возврата домой, поэтому оператор сначала применяет конфигурацию (ControlsCard
// блокирует SEEK-в-HOLD, пока есть непринятые правки).
//
// Подпись кнопки - реальный токен прошивки (SEEK_LOAD / HOMING / RETURN_HOME);
// русское пояснение располагается рядом отдельной меткой.

export interface Availability {
  enabled: boolean;
  command: Command | null;
  /** Токен прошивки, показываемый НА кнопке (например, "SEEK_LOAD"). */
  token: string;
  /** Русское пояснение рядом с кнопкой. */
  gloss: string;
  /** Почему кнопка отключена (заменяет строку пояснения при блокировке). */
  reason: string;
}

/** Доступность управления "SEEK_LOAD". */
export function seekAvailability(state: StandState | null): Availability {
  const base = { token: "SEEK_LOAD", gloss: "Поиск и удержание нагрузки" };
  switch (state) {
    case "IDLE":
      return { ...base, enabled: true, command: "seek", reason: "" };
    case "SEEK_LOAD":
      return { ...base, enabled: false, command: null, reason: "Поиск уже идёт" };
    case "HOLD_LOAD":
      // Повторный поиск от текущей нагрузки к последним ПРИМЕНЁННЫМ target/range.
      // ControlsCard дополнительно блокирует это, пока есть непринятые правки, так
      // что повторный поиск никогда не нацеливается на устаревшее значение,
      // которое оператор забыл применить.
      return { ...base, enabled: true, command: "seek", reason: "", gloss: "Пере-поиск к новой цели" };
    case "HOMING":
    case "RETURN_HOME":
      return { ...base, enabled: false, command: null, reason: "Идёт движение - дождитесь завершения" };
    case "CALIBRATE":
      return { ...base, enabled: false, command: null, reason: "Идёт калибровка нуля" };
    case "ERROR":
      return { ...base, enabled: false, command: null, reason: "Сначала восстановление (HOMING)" };
    case "BOOT":
      return { ...base, enabled: false, command: null, reason: "Стенд инициализируется" };
    default:
      return { ...base, enabled: false, command: null, reason: "Нет связи со стендом" };
  }
}

/**
 * Управление "HOMING / RETURN_HOME". Команда `home` запускает homing из
 * SEEK_LOAD/HOLD_LOAD (→ RETURN_HOME), из ERROR (восстановление) и из IDLE
 * (идемпотентный homing из IDLE).
 */
export function homingAvailability(state: StandState | null): Availability {
  switch (state) {
    case "ERROR":
      return { enabled: true, command: "home", token: "HOMING", gloss: "Восстановление из аварии", reason: "" };
    case "SEEK_LOAD":
    case "HOLD_LOAD":
      return { enabled: true, command: "home", token: "RETURN_HOME", gloss: "Возврат в исходное положение", reason: "" };
    case "IDLE":
      return { enabled: true, command: "home", token: "HOMING", gloss: "Возврат в исходное положение", reason: "" };
    case "CALIBRATE":
      // home во время калибровки = отмена: ноль не меняется, вал едет к прежнему нулю.
      return { enabled: true, command: "home", token: "HOMING", gloss: "Отмена калибровки (к прежнему нулю)", reason: "" };
    case "HOMING":
    case "RETURN_HOME":
      return { enabled: false, command: null, token: "HOMING", gloss: "Возврат в исходное положение", reason: "Homing уже выполняется" };
    case "BOOT":
      return { enabled: false, command: null, token: "HOMING", gloss: "Возврат в исходное положение", reason: "Стенд инициализируется" };
    default:
      return { enabled: false, command: null, token: "HOMING", gloss: "Возврат в исходное положение", reason: "Нет связи со стендом" };
  }
}

/**
 * Доступность управления "RE-TARE" - перезахват нуля тензодатчика (offset нуля
 * HX711) в логическом нуле. Прошивка: POST /v1/tare, WS "tare".
 *
 * Авторитет - прошивка: она перепроверяет полную проверку-ограничитель (IDLE + вал
 * в домашней позиции + датчик готов + |load| ≤ 50 г) в tryRetare и иначе отклоняет,
 * поэтому здесь эта проверка лишь зеркалится для включения/отключения кнопки и
 * объяснения, ПОЧЕМУ она заблокирована. Результат проверки публикуется в
 * телеметрии как `tare_ok`, поэтому блокировка идёт по одному этому флагу, а не
 * выводится заново из нагрузки/угла (единый источник истины, и он уже учитывает
 * пороги 50 г / 1°).
 *
 * `tare_ok` необязателен (старая прошивка его не присылает). При отсутствии поля
 * происходит откат к одному только состоянию: включать лишь в IDLE, с подсказкой,
 * что более полная проверка выполняется на устройстве. Нет связи
 * (telemetry === null) → заблокировано.
 */
export function tareAvailability(telemetry: Telemetry | null): Availability {
  const base = { token: "RE-TARE", gloss: "Перекалибровка нуля" };
  if (!telemetry) {
    return { ...base, enabled: false, command: null, reason: "Нет связи со стендом" };
  }

  const state = telemetry.state;
  // tare_ok - собственный вердикт устройства. При наличии доверять ему дословно.
  if (typeof telemetry.tare_ok === "number") {
    if (telemetry.tare_ok === 1) {
      return { ...base, enabled: true, command: "tare", reason: "" };
    }
    // Заблокировано: дать оператору наиболее полезную причину, выводимую из той же
    // телеметрии, что использует проверка прошивки, не дублируя её точные пороги.
    if (state !== "IDLE") {
      return { ...base, enabled: false, command: null, reason: "Доступно только в состоянии «Ожидание»" };
    }
    if (telemetry.load_ready === 0) {
      return { ...base, enabled: false, command: null, reason: "Датчик ещё не готов" };
    }
    if (Math.abs(telemetry.encoder_rel_deg) > 1.0) {
      return { ...base, enabled: false, command: null, reason: "Вал не в логическом нуле (вернитесь домой)" };
    }
    // Остаётся: реальная нагрузка на датчике (> ~50 г) - обычный случай «снять груз».
    return { ...base, enabled: false, command: null, reason: "Есть нагрузка - снимите груз (нужно < 50 г)" };
  }

  // Старая прошивка без tare_ok: откат к блокировке по состоянию.
  if (state === "IDLE") {
    return { ...base, enabled: true, command: "tare", reason: "" };
  }
  return { ...base, enabled: false, command: null, reason: "Доступно только в состоянии «Ожидание»" };
}

/**
 * Доступность управления "CALIBRATE" - калибровка нуля кулачков. После замены
 * кулачков их механический ноль не совпадает с сохранённым: оператор запускает
 * медленное вращение (calib_plus / calib_minus), а когда кулачки встают в ноль -
 * жмёт STOP, и прошивка принимает текущий угол за новый логический ноль.
 *
 * Здесь описан только ЗАПУСК (кнопка открывает диалог подтверждения с выбором
 * направления, поэтому `command` всегда null). Во время калибровки ControlsCard
 * заменяет эту строку кнопкой STOP.
 */
export function calibAvailability(telemetry: Telemetry | null): Availability {
  const base = { token: "CALIBRATE", gloss: "Калибровка нуля кулачков", command: null };
  if (!telemetry) {
    return { ...base, enabled: false, reason: "Нет связи со стендом" };
  }
  // home_abs_deg присылает только прошивка с поддержкой калибровки.
  if (typeof telemetry.home_abs_deg !== "number") {
    return { ...base, enabled: false, reason: "Прошивка стенда не поддерживает калибровку" };
  }
  switch (telemetry.state) {
    case "IDLE":
    case "ERROR":
      return { ...base, enabled: true, reason: "" };
    case "CALIBRATE":
      return { ...base, enabled: false, reason: "Калибровка уже идёт" };
    case "SEEK_LOAD":
    case "HOLD_LOAD":
      return { ...base, enabled: false, reason: "Сначала верните стенд домой (HOMING)" };
    case "BOOT":
      return { ...base, enabled: false, reason: "Стенд инициализируется" };
    default:
      return { ...base, enabled: false, reason: "Идёт движение - дождитесь завершения" };
  }
}

// ── Метаданные состояния для карточки статуса ────────────────────────────────
// Только русская метка.
export interface StateMeta {
  label: string;
  intent: "idle" | "moving" | "homing" | "hold" | "error" | "boot";
}

export function stateMeta(state: StandState | null): StateMeta {
  switch (state) {
    case "IDLE":
      return { label: "Ожидание", intent: "idle" };
    case "SEEK_LOAD":
      return { label: "Поиск нагрузки", intent: "moving" };
    case "HOLD_LOAD":
      return { label: "Удержание нагрузки", intent: "hold" };
    case "HOMING":
      return { label: "Homing", intent: "homing" };
    case "RETURN_HOME":
      return { label: "Возврат домой", intent: "moving" };
    case "CALIBRATE":
      return { label: "Калибровка нуля", intent: "moving" };
    case "ERROR":
      return { label: "Авария", intent: "error" };
    case "BOOT":
      return { label: "Загрузка", intent: "boot" };
    default:
      return { label: "Нет связи", intent: "idle" };
  }
}
