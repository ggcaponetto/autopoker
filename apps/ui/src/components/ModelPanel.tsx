import { useEffect, useRef, useState } from 'react';
import type {
  EngineMode,
  EngineSettings,
  LlmDecisionRecord,
  LlmProbeResult,
  LlmProvider,
  LlmSentScreenshot,
  LlmSettings,
  MonitorInfo,
  Region,
  Strategy,
} from '@autopoker/shared';

interface Props {
  settings: EngineSettings;
  strategies: Strategy[];
  monitors: MonitorInfo[];
  /** The profile's regions — used to show when view regions override screen selection. */
  regions: Region[];
  probe: LlmProbeResult | null;
  lastDecision: LlmDecisionRecord | null;
  /** True while an "ask the model once" request is in flight. */
  asking: boolean;
  onPatch(partial: Partial<EngineSettings>): void;
  onPatchLlm(partial: Partial<LlmSettings>): void;
  onProbe(): void;
  onTestDecision(): void;
}

const PROVIDERS: { value: LlmProvider; label: string; hint: string }[] = [
  { value: 'ollama', label: 'Ollama (local)', hint: 'runs on this machine, no API key' },
  { value: 'anthropic', label: 'Anthropic', hint: 'needs ANTHROPIC_API_KEY' },
  { value: 'openai', label: 'OpenAI', hint: 'needs OPENAI_API_KEY' },
  { value: 'google', label: 'Google', hint: 'needs GOOGLE_GENERATIVE_AI_API_KEY' },
  { value: 'openai-compatible', label: 'OpenAI-compatible', hint: 'LM Studio, vLLM, OpenRouter…' },
  { value: 'mock', label: 'Mock (no model)', hint: 'scripted decisions, for testing the loop' },
];

/** Fallback suggestions while the provider can't report its own list. */
const MODEL_SUGGESTIONS: Record<LlmProvider, string[]> = {
  ollama: ['qwen3-vl:32b-instruct', 'qwen3-vl:30b-a3b', 'llama3.2-vision', 'minicpm-v'],
  anthropic: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openai: ['gpt-5', 'gpt-5-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  'openai-compatible': [],
  mock: ['mock'],
};

function Num({
  label,
  value,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  onChange(value: number): void;
}) {
  return (
    <label className="field" title={hint}>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function ModelPanel({
  settings,
  strategies,
  monitors,
  regions,
  probe,
  lastDecision,
  asking,
  onPatch,
  onPatchLlm,
  onProbe,
  onTestDecision,
}: Props) {
  const llm = settings.llm;
  const provider = PROVIDERS.find((entry) => entry.value === llm.provider);
  const views = regions.filter((region) => region.enabled && region.purpose === 'view');
  /** Models the Ollama server actually has, when the last probe reached it. */
  const installedModels =
    llm.provider === 'ollama' && probe?.provider === 'ollama' && probe.models.length > 0
      ? probe.models
      : null;

  // Auto-refresh the model list: an Ollama probe is one cheap local /api/tags call,
  // so it can run (debounced) whenever the connection settings or model change —
  // no manual "test connection" click needed to fill the dropdown.
  const onProbeRef = useRef(onProbe);
  useEffect(() => {
    onProbeRef.current = onProbe;
  });
  useEffect(() => {
    if (settings.mode !== 'llm' || llm.provider !== 'ollama') return;
    const timer = setTimeout(() => onProbeRef.current(), 500);
    return () => clearTimeout(timer);
  }, [settings.mode, llm.provider, llm.baseUrl, llm.model]);

  const screenSent = (key: string) => llm.monitorKeys === null || llm.monitorKeys.includes(key);
  const toggleScreen = (key: string) => {
    const next = monitors
      .map((monitor) => monitor.key)
      .filter((candidate) => (candidate === key ? !screenSent(candidate) : screenSent(candidate)));
    // Storing null (= all) when everything is ticked keeps future monitors included.
    onPatchLlm({ monitorKeys: next.length === monitors.length ? null : next });
  };
  const noScreens = llm.monitorKeys !== null && llm.monitorKeys.length === 0;

  return (
    <div className="panel">
      <div className="row mode-switch">
        {(['manual', 'llm'] as EngineMode[]).map((mode) => (
          <button
            key={mode}
            className={settings.mode === mode ? 'primary' : ''}
            onClick={() => onPatch({ mode })}
          >
            {mode === 'manual' ? 'manual rules' : 'LLM decides'}
          </button>
        ))}
      </div>
      <p className="hint">
        {settings.mode === 'manual'
          ? 'Regions run their own actions when their condition fires. No model is called.'
          : 'The model looks at screenshots and decides what to click, following your strategy.'}
      </p>

      {settings.mode === 'llm' && (
        <>
          <label className="field">
            <span>strategy</span>
            <select
              value={settings.strategyId ?? ''}
              onChange={(event) => onPatch({ strategyId: event.target.value || null })}
            >
              <option value="">— none (model has no instructions) —</option>
              {strategies.map((strategy) => (
                <option key={strategy.id} value={strategy.id}>
                  {strategy.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend>model</legend>
            <label className="field">
              <span>provider</span>
              <select
                value={llm.provider}
                onChange={(event) => onPatchLlm({ provider: event.target.value as LlmProvider })}
              >
                {PROVIDERS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            {provider && <p className="hint">{provider.hint}</p>}

            <label className="field grow">
              <span>model</span>
              {installedModels ? (
                <select
                  value={llm.model}
                  onChange={(event) => onPatchLlm({ model: event.target.value })}
                >
                  {!installedModels.includes(llm.model) && (
                    <option value={llm.model}>{llm.model} — not installed on this server</option>
                  )}
                  {installedModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    list="model-suggestions"
                    value={llm.model}
                    onChange={(event) => onPatchLlm({ model: event.target.value })}
                  />
                  <datalist id="model-suggestions">
                    {MODEL_SUGGESTIONS[llm.provider].map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </>
              )}
            </label>
            {installedModels && (
              <p className="hint">
                listing the models installed on your Ollama server — add more with{' '}
                <code>ollama pull</code>
              </p>
            )}

            <label className="field grow">
              <span>base URL</span>
              <input
                placeholder={
                  llm.provider === 'ollama' ? 'http://127.0.0.1:11434' : 'provider default'
                }
                value={llm.baseUrl ?? ''}
                onChange={(event) => onPatchLlm({ baseUrl: event.target.value || undefined })}
              />
            </label>
            <label className="field grow">
              <span>API key env var</span>
              <input
                placeholder="e.g. ANTHROPIC_API_KEY — the key itself is never stored"
                value={llm.apiKeyEnv ?? ''}
                onChange={(event) => onPatchLlm({ apiKeyEnv: event.target.value || undefined })}
              />
            </label>
            {llm.provider === 'ollama' && (
              <label className="field">
                <span>thinking</span>
                <select
                  value={llm.thinking}
                  onChange={(event) =>
                    onPatchLlm({ thinking: event.target.value as LlmSettings['thinking'] })
                  }
                >
                  <option value="auto">model default</option>
                  <option value="off">off — much faster on qwen3/deepseek-style models</option>
                </select>
              </label>
            )}

            <div className="row">
              <button onClick={onProbe}>test connection</button>
              {probe && <span className={`pill ${probe.ok ? 'ok' : 'bad'}`}>{probe.message}</span>}
            </div>
          </fieldset>

          <fieldset>
            <legend>screens to send</legend>
            {views.length > 0 && (
              <p className="pill ok">
                {views.length === 1
                  ? `view region "${views[0]!.name}" is active — only that crop is sent, which is much faster`
                  : `${views.length} view regions are active — only those crops are sent, which is much faster`}
              </p>
            )}
            {monitors.length === 0 && <p className="hint">no monitors reported yet</p>}
            {monitors.map((monitor) => (
              <label key={monitor.key} className="field row">
                <input
                  type="checkbox"
                  checked={screenSent(monitor.key)}
                  disabled={views.length > 0}
                  onChange={() => toggleScreen(monitor.key)}
                />
                <span>
                  {monitor.name} — {monitor.captureWidth}×{monitor.captureHeight}
                  {monitor.isPrimary ? ' (primary)' : ''}
                </span>
              </label>
            ))}
            {views.length === 0 && (
              <p className={noScreens ? 'pill bad' : 'hint'}>
                {noScreens
                  ? 'no screens selected — the model will be blind'
                  : 'each ticked screen is captured and sent with every model call. Tip: draw a "view" region around just the game window to send far fewer pixels.'}
              </p>
            )}
          </fieldset>

          <fieldset>
            <legend>when to ask the model</legend>
            <label className="field">
              <span>trigger</span>
              <select
                value={settings.llmTrigger}
                onChange={(event) =>
                  onPatch({ llmTrigger: event.target.value as EngineSettings['llmTrigger'] })
                }
              >
                <option value="onRegionTrigger">when a region condition fires (cheap)</option>
                <option value="everyTick">every tick (expensive)</option>
              </select>
            </label>
            <div className="row">
              <Num
                label="min gap ms"
                value={llm.minIntervalMs}
                min={0}
                step={500}
                hint="Never call the model more often than this. The main cost control."
                onChange={(minIntervalMs) => onPatchLlm({ minIntervalMs })}
              />
              <Num
                label="timeout ms"
                value={llm.requestTimeoutMs}
                min={5000}
                step={5000}
                onChange={(requestTimeoutMs) => onPatchLlm({ requestTimeoutMs })}
              />
            </div>
          </fieldset>

          <fieldset>
            <legend>safety limits</legend>
            <div className="row">
              <Num
                label="min confidence"
                value={llm.minConfidence}
                min={0}
                max={1}
                step={0.05}
                hint="Decisions below this are logged but never executed."
                onChange={(minConfidence) => onPatchLlm({ minConfidence })}
              />
              <Num
                label="max actions"
                value={llm.maxActionsPerDecision}
                min={1}
                max={20}
                hint="A decision with more actions than this is rejected outright."
                onChange={(maxActionsPerDecision) => onPatchLlm({ maxActionsPerDecision })}
              />
              <Num
                label="history"
                value={llm.historySize}
                min={0}
                max={20}
                hint="How many past decisions the model is reminded of."
                onChange={(historySize) => onPatchLlm({ historySize })}
              />
              <Num
                label="max tokens"
                value={llm.maxOutputTokens}
                min={256}
                step={256}
                onChange={(maxOutputTokens) => onPatchLlm({ maxOutputTokens })}
              />
            </div>
          </fieldset>

          <div className="row">
            <button className="primary" onClick={onTestDecision} disabled={asking}>
              {asking ? <span className="spinner" /> : null}
              {asking ? ' asking the model…' : 'ask the model once'}
            </button>
            <span className="hint">
              {asking
                ? `waiting for ${llm.model} — local models can take a while`
                : 'Takes a screenshot now and shows the decision — never acts.'}
            </span>
          </div>

          {lastDecision && <DecisionCard record={lastDecision} />}
        </>
      )}
    </div>
  );
}

function DecisionCard({ record }: { record: LlmDecisionRecord }) {
  const { decision } = record;
  const [openShot, setOpenShot] = useState<LlmSentScreenshot | null>(null);
  return (
    <div className="decision-card">
      <div className="row">
        <strong>{record.executed ? 'executed' : 'not executed'}</strong>
        <span className="pill">{(decision.confidence * 100).toFixed(0)}% confident</span>
        <span className="region-meta">
          {record.model} · {record.latencyMs}ms
        </span>
      </div>
      {record.skippedReason && <p className="hint">{record.skippedReason}</p>}
      {record.screenshots.length > 0 && (
        <div className="decision-shots">
          <span className="region-meta">sent to the model (click to inspect):</span>
          <div className="row">
            {record.screenshots.map((shot) => (
              <button
                key={shot.label}
                className="shot-thumb"
                title={`"${shot.label}" (monitor ${shot.monitorKey}) — ${shot.captureWidth}×${shot.captureHeight}`}
                onClick={() => setOpenShot(shot)}
              >
                <ShotImage shot={shot} markers={record.markers} />
              </button>
            ))}
          </div>
        </div>
      )}
      {openShot && (
        <div className="shot-modal" onClick={() => setOpenShot(null)}>
          <div className="shot-modal-body" onClick={(event) => event.stopPropagation()}>
            <div className="row">
              <strong>{openShot.label}</strong>
              <span className="region-meta">
                {openShot.label !== openShot.monitorKey
                  ? `view of monitor ${openShot.monitorKey} at (${openShot.originX}, ${openShot.originY}), `
                  : ''}
                {openShot.captureWidth}×{openShot.captureHeight} — exactly what the model saw
                {record.markers.some((marker) => marker.screenshotLabel === openShot.label)
                  ? '; crosshairs mark where it would click'
                  : ''}
              </span>
              <button onClick={() => setOpenShot(null)}>close</button>
            </div>
            <ShotImage shot={openShot} markers={record.markers} />
          </div>
        </div>
      )}
      <p>
        <span className="region-meta">saw</span> {decision.observation}
      </p>
      <p>
        <span className="region-meta">because</span> {decision.reasoning}
      </p>
      <ul className="decision-actions">
        {decision.actions.map((action, index) => (
          <li key={index}>
            <code>
              {action.type}
              {action.regionName ? ` "${action.regionName}"` : ''}
              {action.x !== undefined ? ` (${action.x}, ${action.y})` : ''}
              {action.text ? ` ${JSON.stringify(action.text)}` : ''}
              {action.key ? ` ${action.key}` : ''}
              {action.ms !== undefined ? ` ${action.ms}ms` : ''}
            </code>
          </li>
        ))}
      </ul>
      {record.usage && (
        <p className="region-meta">
          tokens in {record.usage.inputTokens ?? '?'} / out {record.usage.outputTokens ?? '?'}
          {record.usage.cacheReadTokens ? ` · ${record.usage.cacheReadTokens} cached` : ''}
        </p>
      )}
    </div>
  );
}

/**
 * A sent screenshot with the decision's click markers overlaid. Marker positions are
 * percentages of the capture size, so the same markup works at thumbnail and modal scale.
 */
function ShotImage({
  shot,
  markers,
}: {
  shot: LlmSentScreenshot;
  markers: LlmDecisionRecord['markers'];
}) {
  return (
    <span className="shot-wrap">
      <img
        src={`data:image/jpeg;base64,${shot.jpegBase64}`}
        alt={`screenshot "${shot.label}" as sent to the model`}
      />
      {markers
        .filter((marker) => marker.screenshotLabel === shot.label)
        .map((marker) => (
          <span
            key={marker.label}
            className="shot-marker"
            style={{
              left: `${(marker.x / shot.captureWidth) * 100}%`,
              top: `${(marker.y / shot.captureHeight) * 100}%`,
            }}
          >
            <span className="shot-marker-label">{marker.label}</span>
          </span>
        ))}
    </span>
  );
}
