import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { httpBase } from "../config";

// ── Режим калибровки нуля кулачков: вход по паролю и команды ─────────────────
// Логины и пароли хранит и проверяет ПРОШИВКА (Secrets.h), панель их не знает.
// POST /v1/calib action=login отдаёт токен только в ответе на этот запрос; все
// команды калибровки предъявляют его. Токен живёт только в памяти вкладки: после
// перезагрузки страницы или выхода из режима калибровки нужно войти заново.

export type CalibAction = "enter" | "run" | "halt" | "jog" | "save" | "cancel" | "logout";
export type CalibDir = "plus" | "minus";

export interface CalibResult {
  ok: boolean;
  status: number;
  /** Понятная причина отказа (для показа оператору). */
  error?: string;
}

export interface UseCalib {
  /** Есть действующая сессия входа в этой вкладке. */
  loggedIn: boolean;
  user: string | null;
  login: (user: string, pass: string) => Promise<CalibResult>;
  /** Команда калибровки с токеном. При 401 сессия сбрасывается. */
  act: (action: CalibAction, params?: { dir?: CalibDir; deg?: number }) => Promise<CalibResult>;
  /** Забыть сессию (и сообщить стенду, если она ещё действует). */
  logout: () => void;
}

const ERRORS: Record<string, string> = {
  "bad credentials": "Неверный логин или пароль",
  unauthorized: "Сессия входа истекла - войдите снова",
  "queue full": "Стенд занят, повторите",
  "bad dir": "Неверное направление",
  "bad deg": "Неверный угол",
};

export function useCalib(host: string, onLog: (text: string, isError?: boolean) => void): UseCalib {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<string | null>(null);
  // Токен дублируется в ref: команда сразу после входа (enter) должна видеть новый
  // токен, не дожидаясь перерисовки.
  const tokenRef = useRef<string | null>(null);
  const setToken = useCallback((t: string | null) => {
    tokenRef.current = t;
    setTokenState(t);
  }, []);

  // Смена стенда - сессия от другого стенда не годится.
  useEffect(() => {
    setToken(null);
    setUser(null);
  }, [host, setToken]);

  const post = useCallback(
    async (fields: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> | null }> => {
      // Тело form-urlencoded: пароль не попадает в URL.
      const r = await fetch(`${httpBase(host)}/v1/calib`, {
        method: "POST",
        body: new URLSearchParams(fields),
      });
      let body: Record<string, unknown> | null = null;
      try {
        body = (await r.json()) as Record<string, unknown>;
      } catch {
        // тело не JSON
      }
      return { status: r.status, body };
    },
    [host],
  );

  const login = useCallback(
    async (u: string, pass: string): Promise<CalibResult> => {
      try {
        const { status, body } = await post({ action: "login", user: u, pass });
        if (status === 200 && typeof body?.token === "string") {
          setToken(body.token);
          setUser(typeof body.user === "string" ? body.user : u);
          return { ok: true, status };
        }
        if (status === 429) {
          const s = typeof body?.retry_s === "number" ? body.retry_s : 60;
          return { ok: false, status, error: `Слишком много неудачных попыток, вход заблокирован на ${s} с` };
        }
        if (status === 404) {
          return { ok: false, status, error: "Прошивка стенда не поддерживает вход для калибровки" };
        }
        const e = typeof body?.error === "string" ? body.error : "";
        return { ok: false, status, error: ERRORS[e] ?? `Ошибка входа (HTTP ${status})` };
      } catch (e) {
        return { ok: false, status: 0, error: `Стенд недоступен: ${(e as Error).message}` };
      }
    },
    [post, setToken],
  );

  const act = useCallback(
    async (action: CalibAction, params?: { dir?: CalibDir; deg?: number }): Promise<CalibResult> => {
      const token = tokenRef.current;
      if (!token) return { ok: false, status: 401, error: ERRORS.unauthorized };
      const fields: Record<string, string> = { action, token };
      if (params?.dir) fields.dir = params.dir;
      if (params?.deg !== undefined) fields.deg = String(params.deg);
      try {
        const { status, body } = await post(fields);
        if (status === 200 || status === 202) return { ok: true, status };
        if (status === 401) {
          setToken(null);
          setUser(null);
        }
        const e = typeof body?.error === "string" ? body.error : "";
        const error = ERRORS[e] ?? `Ошибка (HTTP ${status})`;
        onLog(`Калибровка: ${error}`, true);
        return { ok: false, status, error };
      } catch (e) {
        const error = `Стенд недоступен: ${(e as Error).message}`;
        onLog(`Калибровка: ${error}`, true);
        return { ok: false, status: 0, error };
      }
    },
    [post, onLog, setToken],
  );

  const logout = useCallback(() => {
    const token = tokenRef.current;
    if (token) {
      post({ action: "logout", token }).catch(() => {});
    }
    setToken(null);
    setUser(null);
  }, [post, setToken]);

  return useMemo(
    () => ({ loggedIn: token !== null, user, login, act, logout }),
    [token, user, login, act, logout],
  );
}
