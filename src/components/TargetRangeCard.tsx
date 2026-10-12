import { useEffect, useRef, useState } from "react";
import { FIRMWARE } from "../config";
import type { ConfigApplyResponse, Telemetry } from "../types";
import { Stepper } from "./Stepper";
import type { Gate } from "../coord/useCoordinator";
import { LockTag } from "./LockTag";

interface Props {
  telemetry: Telemetry | null;
  onApply: (target: number, min: number, max: number) => Promise<ConfigApplyResponse | null>;
  /**
   * Передаёт наверх факт "есть изменения, которые ещё НЕ применены", чтобы
   * ControlsCard мог блокировать SEEK в состоянии HOLD (повторный seek должен
   * нацеливаться на ПРИМЕНЁННОЕ значение, а не на набранное оператором, но не
   * отправленное). Выдаёт true при первом изменении и false после успешного
   * применения. Отличается от внутренней ссылки `dirty`, которая лишь защищает
   * заполнение из телеметрии от затирания редактирования в процессе.
   */
  onDirtyChange?: (dirty: boolean) => void;
  /** Право управления: применять параметры может только владелец канала. */
  gate: Gate;
}

/**
 * Целевая нагрузка + допустимый диапазон. Живой элемент управления: заполняет
 * свои поля из телеметрии (до прихода первого кадра используются значения
 * прошивки по умолчанию), проверяет данные на стороне клиента и отправляет
 * результат через `onApply` методом POST. Ответ самой прошивки является
 * определяющим и показывается даже тогда, когда клиент счёл ввод корректным.
 */
export function TargetRangeCard({ telemetry, onApply, onDirtyChange, gate }: Props) {
  const [target, setTarget] = useState<number>(FIRMWARE.targetKg);
  const [min, setMin] = useState<number>(FIRMWARE.rangeMinKg);
  const [max, setMax] = useState<number>(FIRMWARE.rangeMaxKg);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Заполнение полей из первого пришедшего кадра телеметрии - ЕСЛИ ТОЛЬКО
  // оператор уже не начал редактирование. `dirty` переключается в момент касания
  // любого счётчика, поэтому заполнение никогда не затирает редактирование в
  // процессе (даже самый первый кадр, который может прийти через ~200 мс после
  // подключения, когда оператор уже что-то набрал). `seeded` затем блокирует
  // повторное заполнение на каждом последующем такте 5 Гц.
  //
  // ПРИМЕЧАНИЕ: этот компонент пересоздаётся (key={host} в App), когда оператор
  // направляет дашборд на другой стенд, поэтому seeded/dirty/state сбрасываются, и
  // карточка заполняется из телеметрии НОВОГО стенда, а не показывает устаревшие
  // значения.
  const seeded = useRef(false);
  const dirty = useRef(false);
  const markDirty = <T,>(setter: (v: T) => void) => (v: T) => {
    dirty.current = true;
    onDirtyChange?.(true);  // появились неприменённые изменения -> блокировать SEEK в HOLD
    setter(v);
  };
  useEffect(() => {
    if (seeded.current || dirty.current || !telemetry) return;
    seeded.current = true;
    setTarget(telemetry.target_kg);
    setMin(telemetry.range_min_kg);
    setMax(telemetry.range_max_kg);
  }, [telemetry]);

  const rangeInvalid = min < 0 || min >= max;
  const targetOutOfRange = target < min || target > max;
  const warning = min < 0
    ? "Минимум диапазона не может быть отрицательным."
    : rangeInvalid
      ? "Минимум диапазона должен быть меньше максимума."
      : targetOutOfRange
        ? `Целевая нагрузка вне диапазона ${min.toFixed(2)}–${max.toFixed(2)} кг.`
        : null;

  const canApply = !warning && !applying && gate.allowed;

  const handleApply = async () => {
    if (!canApply) return;
    setApplying(true);
    setResult(null);
    const res = await onApply(target, min, max);
    if (res?.applied) {
      const { target: t, min: mn, max: mx } = res.applied;
      setResult({ ok: true, text: `Применено: target=${t} min=${mn} max=${mx}` });
      dirty.current = false;
      onDirtyChange?.(false);  // изменения применены -> SEEK в HOLD разрешён
    } else {
      const detail = res?.detail ? `: ${res.detail}` : "";
      setResult({ ok: false, text: `Отклонено (${res?.error ?? "ошибка"})${detail}` });
    }
    setApplying(false);
  };

  return (
    <section className="card col-7">
      <div className="title">
        <h2>Целевая нагрузка и диапазон</h2>
        <LockTag gate={gate} />
      </div>

      <div className="form-grid">
        <div className="field">
          <label>Целевая нагрузка, кг</label>
          <Stepper value={target} onChange={markDirty(setTarget)} />
        </div>

        <div className="field-row">
          <div className="field">
            <label>Мин., кг</label>
            <Stepper value={min} onChange={markDirty(setMin)} />
          </div>
          <div className="field">
            <label>Макс., кг</label>
            <Stepper value={max} onChange={markDirty(setMax)} />
          </div>
        </div>

        {warning && <div className="warn-line">⚠ {warning}</div>}
        {!gate.allowed && <div className="lock-line">Применить нельзя: {gate.reason}</div>}

        <button className="btn-apply" disabled={!canApply} onClick={handleApply}>
          {applying ? "Применение…" : "Применить"}
        </button>

        {result && (
          <div className={result.ok ? "note" : "warn-line"}>
            {result.ok ? "✓" : "⚠"} {result.text}
          </div>
        )}
      </div>
    </section>
  );
}
