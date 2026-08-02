import { useState } from 'react';
import {
  RegionSchema,
  type ActionStep,
  type Condition,
  type Region,
  type Rgb,
} from '@autopoker/shared';
import type { BaselineInfo } from '../ws/useServer';

interface Props {
  region: Region;
  lastBaseline: BaselineInfo | null;
  onChange(region: Region): void;
  onSave(): void;
  onDelete(): void;
  onTest(): void;
  onCaptureBaseline(): void;
}

function rgbToHex({ r, g, b }: Rgb): string {
  const hex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function defaultCondition(type: Condition['type'], region: Region): Condition {
  switch (type) {
    case 'colorAtPoint':
      return {
        type,
        point: { x: Math.floor(region.rect.width / 2), y: Math.floor(region.rect.height / 2) },
        color: { r: 255, g: 255, b: 255 },
        tolerance: 10,
      };
    case 'regionAverageColor':
      return { type, color: { r: 255, g: 255, b: 255 }, tolerance: 10 };
    case 'baselineMatch':
      return { type, baselineId: '', maxDiffPercent: 2 };
    case 'baselineChanged':
      return { type, baselineId: '', minDiffPercent: 10 };
  }
}

function defaultStep(type: ActionStep['type']): ActionStep {
  switch (type) {
    case 'moveMouse':
      return { type, target: 'regionCenter' };
    case 'click':
      return { type, button: 'left', double: false, target: 'regionCenter' };
    case 'typeText':
      return { type, text: '' };
    case 'keyTap':
      return { type, key: 'enter', modifiers: [] };
    case 'delay':
      return { type, ms: 500 };
  }
}

function Num({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange(value: number): void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ColorField({ color, onChange }: { color: Rgb; onChange(color: Rgb): void }) {
  return (
    <label className="field">
      <span>color</span>
      <input
        type="color"
        value={rgbToHex(color)}
        onChange={(e) => onChange(hexToRgb(e.target.value))}
      />
      <code>{`${color.r},${color.g},${color.b}`}</code>
    </label>
  );
}

function TargetFields({
  target,
  onChange,
}: {
  target: 'regionCenter' | { x: number; y: number };
  onChange(target: 'regionCenter' | { x: number; y: number }): void;
}) {
  const isCenter = target === 'regionCenter';
  return (
    <>
      <label className="field">
        <span>region center</span>
        <input
          type="checkbox"
          checked={isCenter}
          onChange={(e) => onChange(e.target.checked ? 'regionCenter' : { x: 0, y: 0 })}
        />
      </label>
      {!isCenter && (
        <>
          <Num label="screen x" value={target.x} onChange={(x) => onChange({ ...target, x })} />
          <Num label="screen y" value={target.y} onChange={(y) => onChange({ ...target, y })} />
        </>
      )}
    </>
  );
}

const STEP_TYPES: ActionStep['type'][] = ['moveMouse', 'click', 'typeText', 'keyTap', 'delay'];
const MODIFIERS = ['control', 'shift', 'alt', 'command'] as const;

export function RegionEditor({
  region,
  lastBaseline,
  onChange,
  onSave,
  onDelete,
  onTest,
  onCaptureBaseline,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [newStepType, setNewStepType] = useState<ActionStep['type']>('click');

  const patch = (partial: Partial<Region>) => onChange({ ...region, ...partial });
  const patchCondition = (partial: object) =>
    patch({ condition: { ...region.condition, ...partial } as Condition });
  const patchStep = (index: number, step: ActionStep) =>
    patch({ actions: region.actions.map((existing, i) => (i === index ? step : existing)) });

  const moveStep = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= region.actions.length) return;
    const actions = [...region.actions];
    const [step] = actions.splice(index, 1);
    actions.splice(target, 0, step!);
    patch({ actions });
  };

  const save = () => {
    const condition = region.condition;
    if (
      (condition.type === 'baselineMatch' || condition.type === 'baselineChanged') &&
      !condition.baselineId
    ) {
      setError('Capture a baseline first.');
      return;
    }
    const parsed = RegionSchema.safeParse(region);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
      return;
    }
    setError(null);
    onSave();
  };

  const condition = region.condition;
  const showBaselineThumb =
    (condition.type === 'baselineMatch' || condition.type === 'baselineChanged') &&
    lastBaseline?.baselineId === condition.baselineId;

  return (
    <div className="region-editor">
      <div className="row">
        <label className="field grow">
          <span>name</span>
          <input value={region.name} onChange={(e) => patch({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>enabled</span>
          <input
            type="checkbox"
            checked={region.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
        </label>
      </div>

      <p className="meta">
        {region.monitorKey} · rect {region.rect.x},{region.rect.y} {region.rect.width}×
        {region.rect.height}
      </p>

      <label className="field">
        <span>purpose</span>
        <select
          value={region.purpose}
          onChange={(e) => patch({ purpose: e.target.value as Region['purpose'] })}
        >
          <option value="automate">automate — runs its own actions when triggered</option>
          <option value="landmark">landmark — a target the model can click by name</option>
        </select>
      </label>
      <label className="field grow">
        <span>description</span>
        <input
          placeholder="what this is, in the model's words — e.g. the fold button, bottom left"
          value={region.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </label>

      <fieldset>
        <legend>condition</legend>
        <label className="field">
          <span>type</span>
          <select
            value={condition.type}
            onChange={(e) =>
              patch({ condition: defaultCondition(e.target.value as Condition['type'], region) })
            }
          >
            <option value="colorAtPoint">color at point</option>
            <option value="regionAverageColor">region average color</option>
            <option value="baselineMatch">looks like baseline</option>
            <option value="baselineChanged">changed vs baseline</option>
          </select>
        </label>

        {condition.type === 'colorAtPoint' && (
          <div className="row">
            <Num
              label="x in region"
              value={condition.point.x}
              min={0}
              onChange={(x) => patchCondition({ point: { ...condition.point, x } })}
            />
            <Num
              label="y in region"
              value={condition.point.y}
              min={0}
              onChange={(y) => patchCondition({ point: { ...condition.point, y } })}
            />
            <ColorField color={condition.color} onChange={(color) => patchCondition({ color })} />
            <Num
              label="tolerance"
              value={condition.tolerance}
              min={0}
              max={255}
              onChange={(tolerance) => patchCondition({ tolerance })}
            />
          </div>
        )}

        {condition.type === 'regionAverageColor' && (
          <div className="row">
            <ColorField color={condition.color} onChange={(color) => patchCondition({ color })} />
            <Num
              label="tolerance"
              value={condition.tolerance}
              min={0}
              max={255}
              onChange={(tolerance) => patchCondition({ tolerance })}
            />
          </div>
        )}

        {(condition.type === 'baselineMatch' || condition.type === 'baselineChanged') && (
          <div className="row">
            <button onClick={onCaptureBaseline}>📷 capture baseline from current frame</button>
            {condition.type === 'baselineMatch' ? (
              <Num
                label="max diff %"
                value={condition.maxDiffPercent}
                min={0}
                max={100}
                onChange={(maxDiffPercent) => patchCondition({ maxDiffPercent })}
              />
            ) : (
              <Num
                label="min diff %"
                value={condition.minDiffPercent}
                min={0}
                max={100}
                onChange={(minDiffPercent) => patchCondition({ minDiffPercent })}
              />
            )}
            {condition.baselineId ? (
              showBaselineThumb ? (
                <img
                  className="baseline-thumb"
                  src={`data:image/png;base64,${lastBaseline.pngBase64}`}
                  alt="baseline"
                />
              ) : (
                <code>{condition.baselineId}</code>
              )
            ) : (
              <span className="hint">no baseline captured yet</span>
            )}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>actions</legend>
        {region.purpose === 'landmark' && (
          <p className="hint">
            Landmarks need no actions — the model decides when to click them. Any actions below are
            kept but ignored while this region is a landmark.
          </p>
        )}
        {region.actions.map((step, index) => (
          <div className="step-row" key={index}>
            <span className="step-index">{index + 1}.</span>
            <strong>{step.type}</strong>
            {step.type === 'moveMouse' && (
              <TargetFields
                target={step.target}
                onChange={(target) => patchStep(index, { ...step, target })}
              />
            )}
            {step.type === 'click' && (
              <>
                <label className="field">
                  <span>button</span>
                  <select
                    value={step.button}
                    onChange={(e) =>
                      patchStep(index, { ...step, button: e.target.value as typeof step.button })
                    }
                  >
                    <option value="left">left</option>
                    <option value="right">right</option>
                    <option value="middle">middle</option>
                  </select>
                </label>
                <label className="field">
                  <span>double</span>
                  <input
                    type="checkbox"
                    checked={step.double}
                    onChange={(e) => patchStep(index, { ...step, double: e.target.checked })}
                  />
                </label>
                <TargetFields
                  target={step.target}
                  onChange={(target) => patchStep(index, { ...step, target })}
                />
              </>
            )}
            {step.type === 'typeText' && (
              <label className="field grow">
                <span>text</span>
                <input
                  value={step.text}
                  onChange={(e) => patchStep(index, { ...step, text: e.target.value })}
                />
              </label>
            )}
            {step.type === 'keyTap' && (
              <>
                <label className="field">
                  <span>key</span>
                  <input
                    value={step.key}
                    onChange={(e) => patchStep(index, { ...step, key: e.target.value })}
                  />
                </label>
                {MODIFIERS.map((modifier) => (
                  <label className="field" key={modifier}>
                    <span>{modifier}</span>
                    <input
                      type="checkbox"
                      checked={step.modifiers.includes(modifier)}
                      onChange={(e) =>
                        patchStep(index, {
                          ...step,
                          modifiers: e.target.checked
                            ? [...step.modifiers, modifier]
                            : step.modifiers.filter((existing) => existing !== modifier),
                        })
                      }
                    />
                  </label>
                ))}
              </>
            )}
            {step.type === 'delay' && (
              <Num
                label="ms"
                value={step.ms}
                min={0}
                max={60000}
                onChange={(ms) => patchStep(index, { ...step, ms })}
              />
            )}
            <span className="step-buttons">
              <button onClick={() => moveStep(index, -1)} disabled={index === 0}>
                ↑
              </button>
              <button
                onClick={() => moveStep(index, 1)}
                disabled={index === region.actions.length - 1}
              >
                ↓
              </button>
              <button
                onClick={() => patch({ actions: region.actions.filter((_, i) => i !== index) })}
                disabled={region.actions.length === 1 && region.purpose === 'automate'}
              >
                ✕
              </button>
            </span>
          </div>
        ))}
        <div className="row">
          <select
            value={newStepType}
            onChange={(e) => setNewStepType(e.target.value as ActionStep['type'])}
          >
            {STEP_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button onClick={() => patch({ actions: [...region.actions, defaultStep(newStepType)] })}>
            + step
          </button>
        </div>
      </fieldset>

      <div className="row">
        <Num
          label="confirm ticks"
          value={region.confirmTicks}
          min={1}
          max={100}
          onChange={(confirmTicks) => patch({ confirmTicks })}
        />
        <Num
          label="cooldown ms"
          value={region.cooldownMs}
          min={0}
          onChange={(cooldownMs) => patch({ cooldownMs })}
        />
        <label className="field">
          <span>re-arm</span>
          <select
            value={region.rearm}
            onChange={(e) => patch({ rearm: e.target.value as Region['rearm'] })}
          >
            <option value="afterConditionClears">after condition clears</option>
            <option value="afterCooldown">after cooldown</option>
          </select>
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row">
        <button className="primary" onClick={save}>
          save region
        </button>
        <button onClick={onTest}>test actions</button>
        <button className="danger" onClick={onDelete}>
          delete
        </button>
      </div>
    </div>
  );
}
