import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { httpBase, wsUrl } from "../config";
import {
  isEvent,
  isTelemetry,
  type Command,
  type ConfigApplyResponse,
  type ConnStatus,
  type ForcePoint,
  type StandEvent,
  type StandState,
  type Telemetry,
} from "../types";
import { stateMeta } from "../standLogic";
import type { StandObserver } from "../coord/useCoordinator";

// Одна запись в экранном журнале событий.
export interface LogEntry {
  id: number;
  ts: number; // время по часам клиента, мс
  kind: "state" | "park" | "error" | "wall" | "sys" | "cmd" | "ack" | "tare" | "lock" | "user";
  text: string;
}

// CALIBRATION_FACTOR прошивки (отсчётов на кг) - используется только для вывода
// убранного дрейфа при перетарировании в граммах. Держать синхронно с
// Config::HX711_CALIBRATION_FACTOR.
const HX711_CALIBRATION_FACTOR = 328667;

// Понятная человеку причина отклонённого перетарирования. Поле ack для tare имеет
// вид "tare:ignored_<reason>", где <reason> - токен проверки-ограничителя (НЕ имя
// состояния), поэтому нужно отдельное сопоставление, отличное от общего пути
// команд-ack.
const TARE_REJECT_REASON: Record<string, string> = {
  not_idle: "стенд не в «Ожидании»",
  not_home: "вал не в логическом нуле",
  not_ready: "датчик не готов",
  load_too_high: "есть нагрузка (> 50 г)",
  offset_insane: "замер вне допустимых границ",
};

export interface UseStand {
  status: ConnStatus;
  telemetry: Telemetry | null;
  /** Скользящая история усилия для графика (от старых к новым). */
  history: ForcePoint[];
  log: LogEntry[];
  /** Отправить текстовый кадр команды по WS (при закрытом сокете - откат на REST). */
  send: (cmd: Command) => void;
  /** POST обновлённых target/min/max на стенд; возвращает разобранный ответ. */
  sendConfig: (target: number, min: number, max: number) => Promise<ConfigApplyResponse | null>;
  /** Принудительно выполнить немедленное (пере)подключение к `host`. */
  reconnect: () => void;
  /** Добавить строку в экранный журнал (например, действия других людей). */
  note: (kind: LogEntry["kind"], text: string) => void;
}

const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 15000;
// Попытка подключения, которая за этот бюджет не открывается и не закрывается,
// считается неудачной и разрывается, чтобы не висеть на ~40-секундном TCP-таймауте
// браузера (что выглядит для оператора как застывшая строка "Подключение…").
const CONNECT_TIMEOUT = 6000;
// Скользящее окно графика. При ~5 Гц 600 точек ≈ 2 минуты истории.
const HISTORY_MAX = 600;
const LOG_MAX = 300;
// Если стенд закрыл сокет быстрее этого после открытия и не прислал ни одного
// кадра - почти наверняка сработал лимит клиентов прошивки (NET_MAX_WS_CLIENTS):
// прошивка принимает подключение и тут же его закрывает.
const INSTANT_CLOSE_MS = 2000;

/**
 * Владеет WebSocket-соединением со стендом и предоставляет реактивную телеметрию,
 * журнал событий, буфер истории усилия для графика и отправитель команд.
 * Переподключается с экспоненциальной задержкой. Смена `host` разрывает соединение
 * и переподключается заново.
 */
export function useStand(host: string, observer?: StandObserver): UseStand {
  const [status, setStatus] = useState<ConnStatus>("disconnected");
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [history, setHistory] = useState<ForcePoint[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const reconnectDelay = useRef<number>(RECONNECT_MIN);
  const manualClose = useRef<boolean>(false);
  const logId = useRef<number>(0);
  // Начало отсчёта для оси X графика, чтобы uPlot видел небольшие стабильные числа.
  const t0 = useRef<number>(Date.now());

  // Индикация хода подключения, намеренно спокойная и единообразная:
  //   attemptRef - счётчик попыток, показываемый в журнале ("Попытка N")
  //   liveId     - id ЕДИНСТВЕННОЙ строки журнала, обновляемой на месте, чтобы
  //                попытка и её итог использовали одну строку, а не засоряли журнал.
  // Тикающих обратных отсчётов НЕТ. Во время попытки строка статична; при неудаче
  // в ней указано, когда пройдёт следующая попытка (абсолютное время по часам).
  const attemptRef = useRef<number>(0);
  const liveId = useRef<number | null>(null);
  // Таймер-ограничитель на попытку: срабатывает через CONNECT_TIMEOUT после старта
  // подключения, если сокет не открылся, чтобы не зависать на заклинившем соединении.
  const connectTimeout = useRef<number | null>(null);
  // Наблюдатель (серверный журнал) хранится в ref, чтобы не пересоздавать connect().
  const observerRef = useRef<StandObserver | undefined>(observer);
  observerRef.current = observer;

  const pushLog = useCallback((kind: LogEntry["kind"], text: string) => {
    setLog((prev) => {
      const next = prev.concat({
        id: logId.current++,
        ts: Date.now(),
        kind,
        text,
      });
      return next.length > LOG_MAX ? next.slice(next.length - LOG_MAX) : next;
    });
  }, []);

  // Обновить закреплённую "живую" строку на месте (или создать её). Используется
  // для статуса подключения / ожидания повтора, чтобы не переполнять журнал.
  const setLive = useCallback((kind: LogEntry["kind"], text: string) => {
    setLog((prev) => {
      if (liveId.current !== null) {
        const idx = prev.findIndex((e) => e.id === liveId.current);
        if (idx !== -1) {
          const copy = prev.slice();
          copy[idx] = { ...copy[idx], kind, text };
          return copy;
        }
      }
      const id = logId.current++;
      liveId.current = id;
      const next = prev.concat({ id, ts: Date.now(), kind, text });
      return next.length > LOG_MAX ? next.slice(next.length - LOG_MAX) : next;
    });
  }, []);

  // Открепить живую строку, чтобы она осталась постоянной записью; следующий
  // вызов setLive() начнёт новую строку.
  const commitLive = useCallback(() => {
    liveId.current = null;
  }, []);

  // Форматировать абсолютное время по часам как ЧЧ:ММ:СС для "следующая в …".
  const clockAt = (ms: number): string => {
    const d = new Date(ms);
    const p2 = (n: number) => (n < 10 ? "0" : "") + n;
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  };

  const handleTelemetry = useCallback((t: Telemetry) => {
    setTelemetry(t);
    setHistory((prev) => {
      const point: ForcePoint = {
        t: (Date.now() - t0.current) / 1000,
        kg: Number(t.load_kg) || 0,
      };
      const next = prev.concat(point);
      return next.length > HISTORY_MAX
        ? next.slice(next.length - HISTORY_MAX)
        : next;
    });
  }, []);

  const handleEvent = useCallback(
    (ev: StandEvent) => {
      // Ack команды: прошивка присылает detail вида "<CMD>:ok" или
      // "<CMD>:ignored_<STATE>". Выводится читаемой строкой принятия/отклонения, а
      // не сырым токеном, чтобы оператор видел, почему команда отклонена, хотя
      // клиентская блокировка уже предсказывает большинство случаев.
      if (ev.event === "ack") {
        const [cmd, result] = (ev.detail ?? "").split(":");
        // Ack перетарирования несёт токен ПРОВЕРКИ-ОГРАНИЧИТЕЛЯ (не состояние),
        // поэтому обрабатывается отдельно.
        if (cmd === "tare") {
          if (result === "ok") {
            // Следом идёт событие "tare" с изменением смещения; эта строка ack
            // держится короткой, чтобы две записи не дублировали число.
            pushLog("tare", "Перекалибровка нуля принята");
          } else if (result?.startsWith("ignored")) {
            const tok = result.replace("ignored_", "");
            const why = TARE_REJECT_REASON[tok] ?? tok ?? "guard не пройден";
            pushLog("error", `Перекалибровка отклонена: ${why}`);
          } else {
            pushLog("ack", `tare · ${result ?? ""}`);
          }
          return;
        }
        let text: string;
        if (result === "ok") {
          text = `${cmd} принята`;
        } else if (result?.startsWith("ignored")) {
          // Сырой токен состояния прошивки (например, "HOLD_LOAD") сопоставляется
          // с русской меткой, чтобы причина отклонения читалась естественно, а не
          // как перечисление.
          const stateTok = result.replace("ignored_", "");
          const why = stateTok ? stateMeta(stateTok as StandState).label : "неверное состояние";
          text = `${cmd} отклонена (${why})`;
        } else {
          text = `${cmd} · ${result ?? ""}`;
        }
        pushLog("ack", text);
        return;
      }

      // Успешное перетарирование: detail - "off=<new> prev=<old>" (сырые отсчёты).
      // Показывается изменение нуля и убранный дрейф в граммах - это полезный итог.
      if (ev.event === "tare") {
        const m = /off=(-?\d+)\s+prev=(-?\d+)/.exec(ev.detail ?? "");
        if (m) {
          const next = Number(m[1]);
          const prev = Number(m[2]);
          const driftG = ((prev - next) / HX711_CALIBRATION_FACTOR) * 1000;
          pushLog(
            "tare",
            `Ноль пере-захвачен: ${prev} → ${next} (убрано ${driftG >= 0 ? "+" : ""}${driftG.toFixed(1)} г дрейфа)`,
          );
        } else {
          pushLog("tare", `Перекалибровка нуля: ${ev.detail ?? ""}`);
        }
        return;
      }
      // Итог калибровки нуля кулачков.
      if (ev.event === "calib") {
        const m = /home=(-?[\d.]+)\s+prev=(-?[\d.]+)/.exec(ev.detail ?? "");
        if (m) {
          pushLog("tare", `Ноль кулачков откалиброван: ${m[2]}° → ${m[1]}° (сохранён на стенде)`);
        } else if (ev.detail === "cancelled") {
          pushLog("tare", "Калибровка отменена: ноль не изменён, возврат к прежнему нулю");
        } else if (ev.detail === "timeout") {
          pushLog("tare", "Калибровка завершена по бездействию: ноль не изменён");
        } else if (ev.detail === "aborted_load") {
          pushLog("error", "Калибровка: движение остановлено стендом - выросла нагрузка");
        } else if (ev.detail === "aborted_travel") {
          pushLog("error", "Калибровка: вращение остановлено стендом - 2 оборота без «Стоп»");
        } else {
          pushLog("tare", `Калибровка нуля: ${ev.detail ?? ""}`);
        }
        return;
      }
      if (ev.event === "motor") {
        if (ev.detail === "released") {
          pushLog("sys", "Мотор отключён: нет нагрузки (включится сам при движении)");
        } else {
          pushLog("sys", `Мотор: ${ev.detail ?? ""}`);
        }
        return;
      }
      const kind =
        ev.event === "state" || ev.event === "park" || ev.event === "error" || ev.event === "wall"
          ? ev.event
          : "sys";
      const label = ev.event.toUpperCase();
      pushLog(kind, ev.detail ? `${label} · ${ev.detail}` : label);
    },
    [pushLog],
  );

  // Стабильная функция подключения, привязанная к host. Все изменяемые части
  // соединения намеренно хранятся в ref-ах, чтобы её не пересоздавать на каждый
  // рендер.
  const connect = useCallback(() => {
    if (reconnectTimer.current !== null) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (connectTimeout.current !== null) {
      clearTimeout(connectTimeout.current);
      connectTimeout.current = null;
    }
    if (wsRef.current) {
      // Отсоединить обработчики, чтобы асинхронный onclose старого сокета не
      // запустил логику повтора этой попытки (исключает дублирующее
      // переподключение при ручном переподключении).
      const old = wsRef.current;
      old.onopen = old.onclose = old.onmessage = old.onerror = null;
      try {
        old.close();
      } catch {
        // игнорируется
      }
      wsRef.current = null;
    }
    manualClose.current = false;

    const url = wsUrl(host);
    const attempt = ++attemptRef.current;
    setStatus("reconnecting");

    // Статичная строка на всю попытку - без тиканья. Переиспользуется (setLive),
    // чтобы итог перезаписал эту же строку.
    setLive("sys", `Попытка ${attempt}: подключение к ${url}…`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      failAttempt();
      return;
    }
    wsRef.current = ws;

    const clearConnectTimeout = () => {
      if (connectTimeout.current !== null) {
        clearTimeout(connectTimeout.current);
        connectTimeout.current = null;
      }
    };

    // Единый путь неудачи для этой попытки: записать "не удалась + следующая в
    // ЧЧ:ММ:СС" и запланировать повтор с задержкой. Идемпотентно на попытку.
    let settled = false;
    let openedAt = 0;
    let gotFrame = false;
    function failAttempt() {
      if (settled) return;
      settled = true;
      clearConnectTimeout();
      if (manualClose.current) return;
      setStatus("reconnecting");
      const delayMs = reconnectDelay.current;
      const nextAt = clockAt(Date.now() + delayMs);
      setLive("sys", `Попытка ${attempt} не удалась. Следующая в ${nextAt}`);
      commitLive();
      reconnectDelay.current = Math.min(delayMs * 1.7, RECONNECT_MAX);
      reconnectTimer.current = window.setTimeout(() => {
        reconnectTimer.current = null;
        connect();
      }, delayMs);
    }

    // Защита: если сокет не открывается за отведённый бюджет, принудительно
    // закрыть его и уйти на путь повтора, а не висеть на TCP-таймауте ОС.
    connectTimeout.current = window.setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.close();
        } catch {
          // игнорируется
        }
        failAttempt();
      }
    }, CONNECT_TIMEOUT);

    ws.onopen = () => {
      settled = true;
      openedAt = Date.now();
      clearConnectTimeout();
      reconnectDelay.current = RECONNECT_MIN;
      setStatus("connected");
      // Перезаписать строку попытки записью об успехе, затем начать заново.
      setLive("state", `Подключено (попытка ${attempt})`);
      commitLive();
      attemptRef.current = 0;
    };

    ws.onmessage = (evt) => {
      let msg: unknown;
      try {
        msg = JSON.parse(evt.data as string);
      } catch {
        return;
      }
      gotFrame = true;
      if (isEvent(msg)) {
        handleEvent(msg);
        observerRef.current?.onEvent(msg);
      } else if (isTelemetry(msg)) {
        handleTelemetry(msg);
        observerRef.current?.onTelemetry(msg as unknown as { uptime_ms: number } & Record<string, unknown>);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (openedAt && !gotFrame && Date.now() - openedAt < INSTANT_CLOSE_MS) {
        pushLog(
          "error",
          "Стенд закрыл соединение сразу после подключения - вероятно, занято максимальное число подключений к стенду (4). Закройте лишние вкладки панели.",
        );
      }
      // Единый путь независимо от того, не открылся ли сокет или отвалился уже в
      // рабочем состоянии: записать неудачную попытку + время следующей и
      // запланировать повтор.
      failAttempt();
    };

    ws.onerror = () => {
      // Далее следует onclose, который через failAttempt() запускает повтор.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, handleEvent, handleTelemetry, setLive, commitLive, pushLog]);

  // (Пере)подключаться при каждой смене host; очистка при размонтировании. Смена
  // host - это старт с чистого листа: сбросить счётчик попыток и живую строку.
  useEffect(() => {
    attemptRef.current = 0;
    reconnectDelay.current = RECONNECT_MIN;
    liveId.current = null;
    connect();
    return () => {
      manualClose.current = true;
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (connectTimeout.current !== null) {
        clearTimeout(connectTimeout.current);
        connectTimeout.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // игнорируется
        }
        wsRef.current = null;
      }
      setStatus("disconnected");
    };
  }, [connect]);

  const send = useCallback(
    (cmd: Command) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(cmd);
        pushLog("cmd", `→ отправлено "${cmd}"`);
        return;
      }
      // WS недоступен - откат на REST по мере возможности, чтобы кнопки всё равно
      // что-то делали, пока стенд достижим по HTTP, даже если сокет нестабилен.
      // Причина отказа самого стенда (400 unknown / 503 очередь переполнена)
      // выводится, чтобы отклонённая команда объясняла себя, а не молча бездействовала.
      pushLog("cmd", `WS закрыт, пробую REST: ${cmd}`);
      fetch(`${httpBase(host)}/v1/command?cmd=${cmd}`, { method: "POST" })
        .then(async (r) => {
          let detail = "";
          try {
            const j = (await r.json()) as { error?: string; accepted?: string };
            detail = j.error ? ` - ${j.error}` : j.accepted ? ` - принято` : "";
          } catch {
            // тело не JSON; игнорируется
          }
          const kind = r.ok ? "cmd" : "error";
          pushLog(kind, `REST ${cmd}: HTTP ${r.status}${detail}`);
        })
        .catch((e) => pushLog("sys", `REST ошибка: ${(e as Error).message}`));
    },
    [host, pushLog],
  );

  const sendConfig = useCallback(
    async (target: number, min: number, max: number): Promise<ConfigApplyResponse | null> => {
      try {
        const r = await fetch(
          `${httpBase(host)}/v1/config?target=${target}&min=${min}&max=${max}`,
          { method: "POST" },
        );
        let body: ConfigApplyResponse | null = null;
        try {
          body = (await r.json()) as ConfigApplyResponse;
        } catch {
          // тело не JSON; игнорируется
        }
        if (r.ok && body?.applied) {
          const { target: t, min: mn, max: mx } = body.applied;
          pushLog(
            "cmd",
            `Конфигурация применена: target=${t} min=${mn} max=${mx} (HTTP ${r.status})`,
          );
        } else {
          const detail = body?.detail ? ` - ${body.detail}` : "";
          pushLog("error", `Конфигурация отклонена: HTTP ${r.status} ${body?.error ?? ""}${detail}`);
        }
        return body;
      } catch (e) {
        pushLog("error", `Ошибка запроса конфигурации: ${(e as Error).message}`);
        return null;
      }
    },
    [host, pushLog],
  );

  const reconnect = useCallback(() => {
    reconnectDelay.current = RECONNECT_MIN;
    attemptRef.current = 0;
    commitLive(); // начать новую живую строку для новой попытки
    connect();
  }, [connect, commitLive]);

  return useMemo(
    () => ({ status, telemetry, history, log, send, sendConfig, reconnect, note: pushLog }),
    [status, telemetry, history, log, send, sendConfig, reconnect, pushLog],
  );
}
