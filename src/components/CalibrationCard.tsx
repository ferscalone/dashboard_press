import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Telemetry } from "../types";
import type { Gate } from "../coord/useCoordinator";
import type { CalibDir, UseCalib } from "../hooks/useCalib";
import { LockTag } from "./LockTag";

// Шаги поворота на угол. Шаг двигателя 0.45°, поэтому прошивка округляет угол до
// целого числа шагов: 1° -> 0.9°, 5° -> 4.95°, 10° -> 9.9°.
const JOG_STEPS_DEG = [1, 5, 10] as const;

interface Props {
  telemetry: Telemetry | null;
  calib: UseCalib;
  gate: Gate;
  onOpenLogin: () => void;
  /** «Стоп» движения - обычная команда stop (без входа: это безопасность). */
  onStop: () => void;
  /** Запись действия в общий журнал (кто что сделал). */
  onReport: (text: string) => void;
}

/**
 * Панель режима калибровки нуля кулачков (видна, пока стенд в CALIBRATE). Вал стоит,
 * пока оператор не попросит движения: плавное вращение до «Стоп» или поворот на
 * 1 / 5 / 10° в выбранную сторону. «Сохранить как ноль» принимает текущее
 * положение за новый ноль; «Отмена» возвращает вал к прежнему нулю.
 *
 * Управлять может только тот, кто вошёл по логину и паролю в ЭТОЙ вкладке и
 * владеет каналом управления; остальные видят состояние без кнопок.
 */
export function CalibrationCard({ telemetry, calib, gate, onOpenLogin, onStop, onReport }: Props) {
  const [jogDir, setJogDir] = useState<CalibDir>("plus");
  // Направление идущего плавного вращения (null - не крутим). Нужно, чтобы во время
  // вращения не давать поворот на угол (прошивка его всё равно отклонит).
  const [runDir, setRunDir] = useState<CalibDir | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const busy = telemetry?.calib_busy === 1;

  // Вращение закончилось (стоп, защита стенда) - сбросить локальный признак.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) setRunDir(null);
    wasBusy.current = busy;
  }, [busy]);

  // Подтверждение сохранения само гаснет через несколько секунд.
  useEffect(() => {
    if (!confirmSave) return;
    const t = window.setTimeout(() => setConfirmSave(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmSave]);

  const canAct = calib.loggedIn && gate.allowed;
  const dirLabel = (d: CalibDir) => (d === "plus" ? "+" : "−");

  const run = async (dir: CalibDir) => {
    const r = await calib.act("run", { dir });
    if (r.ok) {
      setRunDir(dir);
      onReport(`калибровка: вращение ${dirLabel(dir)}`);
    }
  };
  const halt = () => {
    onStop();
    setRunDir(null);
  };
  const jog = async (deg: number) => {
    const r = await calib.act("jog", { dir: jogDir, deg });
    if (r.ok) onReport(`калибровка: поворот ${dirLabel(jogDir)}${deg}°`);
  };
  const save = async () => {
    if (!confirmSave) {
      setConfirmSave(true);
      return;
    }
    setConfirmSave(false);
    const r = await calib.act("save");
    if (r.ok) onReport("калибровка: новый ноль сохранён");
  };
  const cancel = async () => {
    const r = await calib.act("cancel");
    if (r.ok) onReport("калибровка: отменена, ноль не изменён");
  };

  const fmt = (v: number | undefined) => (typeof v === "number" ? `${v.toFixed(2)}°` : "–");

  let lockText: string | null = null;
  if (!gate.allowed) lockText = gate.reason;
  else if (!calib.loggedIn) lockText = "Для управления калибровкой войдите по логину и паролю.";

  return (
    <section className="card col-12 calib-card">
      <div className="title">
        <h2>Калибровка нуля кулачков</h2>
        {calib.loggedIn ? (
          <span className="tag ok">Вход: {calib.user}</span>
        ) : (
          <LockTag gate={gate} />
        )}
      </div>

      <div className="calib-readout">
        <div>
          <span className="lbl">От текущего нуля</span>
          <span className="val num">{fmt(telemetry?.encoder_rel_deg)}</span>
        </div>
        <div>
          <span className="lbl">Абс. угол</span>
          <span className="val num">{fmt(telemetry?.encoder_abs_deg)}</span>
        </div>
        <div>
          <span className="lbl">Сохранённый ноль</span>
          <span className="val num">{fmt(telemetry?.home_abs_deg)}</span>
        </div>
        <div>
          <span className="lbl">Вал</span>
          <span className={`tag ${busy ? "busy" : ""}`}>{busy ? "движется" : "стоит"}</span>
        </div>
      </div>

      {lockText && (
        <div className="calib-lock">
          <span>{lockText}</span>
          {gate.allowed && !calib.loggedIn && (
            <button className="chip primary" onClick={onOpenLogin}>
              Войти
            </button>
          )}
        </div>
      )}

      <div className="calib-sections">
        <div className="calib-section">
          <div className="calib-section-title">Плавное вращение</div>
          <div className="calib-btns">
            <button className="ctl-btn secondary" disabled={!canAct || runDir !== null} onClick={() => run("minus")}>
              ◀ Вращать −
            </button>
            <button className="ctl-btn stop" disabled={!busy || !gate.allowed} onClick={halt} title="Остановить вращение или поворот">
              ■ Стоп
            </button>
            <button className="ctl-btn secondary" disabled={!canAct || runDir !== null} onClick={() => run("plus")}>
              Вращать + ▶
            </button>
          </div>
          <div className="calib-hint">«+» - в сторону поджатия платы, «−» - от платы.</div>
        </div>

        <div className="calib-section">
          <div className="calib-section-title">Поворот на угол</div>
          <div className="calib-btns">
            <div className="seg" role="group" aria-label="Направление поворота">
              <button
                className={jogDir === "minus" ? "on" : ""}
                disabled={!canAct}
                onClick={() => setJogDir("minus")}
              >
                −
              </button>
              <button
                className={jogDir === "plus" ? "on" : ""}
                disabled={!canAct}
                onClick={() => setJogDir("plus")}
              >
                +
              </button>
            </div>
            {JOG_STEPS_DEG.map((d) => (
              <button
                key={d}
                className="ctl-btn"
                disabled={!canAct || runDir !== null}
                onClick={() => jog(d)}
              >
                {dirLabel(jogDir)}
                {d}°
              </button>
            ))}
          </div>
          <div className="calib-hint">Шаг мотора 0,45°: 1° ≈ 0,9°, 5° ≈ 4,95°, 10° ≈ 9,9°. Точный угол - по энкодеру выше.</div>
        </div>

        <div className="calib-section">
          <div className="calib-section-title">Завершение</div>
          <div className="calib-btns">
            <button className="ctl-btn" disabled={!canAct || busy} onClick={save}>
              {confirmSave ? "Точно сохранить?" : "Сохранить как ноль"}
            </button>
            <button className="ctl-btn secondary" disabled={!canAct} onClick={cancel}>
              Отмена
            </button>
          </div>
          <div className="calib-hint">
            {confirmSave
              ? "Нажмите ещё раз: текущее положение станет новым нулём."
              : "Отмена: ноль не меняется, вал вернётся к прежнему нулю."}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Вход в режим калибровки: логин и пароль проверяет прошивка стенда. Esc и щелчок
 * мимо окна закрывают его.
 */
export function CalibLoginDialog({
  calib,
  onClose,
  onSuccess,
}: {
  calib: UseCalib;
  onClose: () => void;
  onSuccess: (user: string) => void;
}) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user.trim() || !pass || pending) return;
    setPending(true);
    setError(null);
    const r = await calib.login(user.trim(), pass);
    setPending(false);
    if (r.ok) {
      setPass("");
      onSuccess(user.trim());
    } else {
      setError(r.error ?? "Ошибка входа");
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal card calib-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Вход в режим калибровки"
        onSubmit={submit}
      >
        <div className="title">
          <h2>Калибровка нуля кулачков</h2>
          <button type="button" className="chip" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <p>
          Режим калибровки доступен только после входа. После входа кулачки <b>стоят</b> -
          вращение начнётся только по вашей команде.
        </p>
        <div className="field">
          <label htmlFor="calib-user">Логин</label>
          <input
            id="calib-user"
            className="text-input"
            autoComplete="username"
            autoFocus
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="calib-pass">Пароль</label>
          <input
            id="calib-pass"
            className="text-input"
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </div>
        {error && <div className="warn-line">⚠ {error}</div>}
        <button type="submit" className="btn-apply" disabled={pending || !user.trim() || !pass}>
          {pending ? "Проверка…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
