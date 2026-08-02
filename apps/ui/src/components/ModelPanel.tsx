import type {
  EngineMode,
  EngineSettings,
  LlmDecisionRecord,
  LlmProbeResult,
  LlmProvider,
  LlmSettings,
  Strategy,
} from '@autopoker/shared';

interface Props {
  settings: EngineSettings;
  strategies: Strategy[];
  probe: LlmProbeResult | null;
  lastDecision: LlmDecisionRecord | null;
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

/** Sensible starting models per provider; the field stays free-text. */
const MODEL_SUGGESTIONS: Record<LlmProvider, string[]> = {
  ollama: ['llama3.2-vision', 'qwen2.5vl', 'minicpm-v', 'llava'],
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
  probe,
  lastDecision,
  onPatch,
  onPatchLlm,
  onProbe,
  onTestDecision,
}: Props) {
  const llm = settings.llm;
  const provider = PROVIDERS.find((entry) => entry.value === llm.provider);

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
              <input
                list="model-suggestions"
                value={llm.model}
                onChange={(event) => onPatchLlm({ model: event.target.value })}
              />
              <datalist id="model-suggestions">
                {(probe?.models.length ? probe.models : MODEL_SUGGESTIONS[llm.provider]).map(
                  (model) => (
                    <option key={model} value={model} />
                  ),
                )}
              </datalist>
            </label>

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

            <div className="row">
              <button onClick={onProbe}>test connection</button>
              {probe && <span className={`pill ${probe.ok ? 'ok' : 'bad'}`}>{probe.message}</span>}
            </div>
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
            <button className="primary" onClick={onTestDecision}>
              ask the model once
            </button>
            <span className="hint">
              Takes a screenshot now and shows the decision — never acts.
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
