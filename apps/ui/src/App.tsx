import { useEffect, useMemo, useState } from 'react';
import {
  createDefaultSettings,
  ProfileSchema,
  RegionSchema,
  StrategySchema,
  type EngineSettings,
  type LlmSettings,
  type Profile,
  type Rect,
  type Region,
  type Strategy,
} from '@autopoker/shared';
import { EngineControls } from './components/EngineControls';
import { EventLog } from './components/EventLog';
import { ModelPanel } from './components/ModelPanel';
import { MonitorPreview } from './components/MonitorPreview';
import { RegionEditor } from './components/RegionEditor';
import { RegionList } from './components/RegionList';
import { StrategyPanel } from './components/StrategyPanel';
import { useServer } from './ws/useServer';

type Tab = 'regions' | 'strategy' | 'model';

export function App() {
  const { state, send, subscribe } = useServer();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Region | null>(null);
  const [tab, setTab] = useState<Tab>('regions');
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);

  const profile = useMemo(
    () =>
      state.profiles.find((candidate) => candidate.id === selectedProfileId) ??
      state.profiles[0] ??
      null,
    [state.profiles, selectedProfileId],
  );

  useEffect(() => {
    if (!state.connected) return;
    for (const monitor of state.monitors) {
      send({ type: 'subscribePreview', monitorKey: monitor.key, maxFps: 1 });
    }
  }, [state.connected, state.monitors, send]);

  // Adopt freshly captured baselines into the open editor draft.
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'baselineCaptured') return;
        setDraft((current) =>
          current &&
          (current.condition.type === 'baselineMatch' ||
            current.condition.type === 'baselineChanged')
            ? { ...current, condition: { ...current.condition, baselineId: message.baselineId } }
            : current,
        );
      }),
    [subscribe],
  );

  const saveProfile = (updated: Profile) => send({ type: 'saveProfile', profile: updated });

  const upsertRegion = (region: Region) => {
    if (!profile) return;
    const exists = profile.regions.some((candidate) => candidate.id === region.id);
    const regions = exists
      ? profile.regions.map((candidate) => (candidate.id === region.id ? region : candidate))
      : [...profile.regions, region];
    saveProfile({ ...profile, regions });
  };

  const createProfile = (name: string) => {
    const created = ProfileSchema.parse({
      id: crypto.randomUUID(),
      name,
      regions: [],
      settings: createDefaultSettings(),
    });
    saveProfile(created);
    setSelectedProfileId(created.id);
  };

  const patchSettings = (partial: Partial<EngineSettings>) => {
    if (!profile) return;
    saveProfile({ ...profile, settings: { ...profile.settings, ...partial } });
  };

  const patchLlm = (partial: Partial<LlmSettings>) => {
    if (!profile) return;
    patchSettings({ llm: { ...profile.settings.llm, ...partial } });
  };

  const strategy =
    state.strategies.find((candidate) => candidate.id === selectedStrategyId) ??
    state.strategies.find((candidate) => candidate.id === profile?.settings.strategyId) ??
    state.strategies[0] ??
    null;

  const createStrategy = (name: string) => {
    const created = StrategySchema.parse({ id: crypto.randomUUID(), name });
    send({ type: 'saveStrategy', strategy: created });
    setSelectedStrategyId(created.id);
  };

  const uploadAttachment = (strategyId: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return;
      send({
        type: 'uploadAttachment',
        strategyId,
        filename: file.name,
        mediaType: file.type || 'text/plain',
        dataBase64: result.slice(result.indexOf(',') + 1),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleCreateRect = (monitorKey: string, rect: Rect) => {
    if (!profile) createProfile('Default');
    const count = profile?.regions.length ?? 0;
    setDraft(
      RegionSchema.parse({
        id: crypto.randomUUID(),
        name: `Region ${count + 1}`,
        monitorKey,
        rect,
        condition: {
          type: 'colorAtPoint',
          point: { x: Math.floor(rect.width / 2), y: Math.floor(rect.height / 2) },
          color: { r: 255, g: 255, b: 255 },
          tolerance: 10,
        },
        actions: [{ type: 'click' }],
      }),
    );
  };

  const regionsFor = (monitorKey: string): Region[] => {
    const saved = (profile?.regions ?? []).filter((region) => region.monitorKey === monitorKey);
    if (draft && draft.monitorKey === monitorKey) {
      return [...saved.filter((region) => region.id !== draft.id), draft];
    }
    return saved;
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>autopoker</h1>
        <EngineControls
          connected={state.connected}
          engineState={state.engineState}
          profiles={state.profiles}
          selectedProfileId={profile?.id ?? null}
          onSelectProfile={setSelectedProfileId}
          onCreateProfile={createProfile}
          onStart={() => profile && send({ type: 'start', profileId: profile.id })}
          onStop={() => send({ type: 'stop' })}
          onSetDryRun={(enabled) => send({ type: 'setDryRun', enabled })}
        />
      </header>
      <main>
        <div className="previews">
          {state.monitors.length === 0 && (
            <p className="hint">
              {state.connected ? 'no monitors reported' : 'connecting to ws://localhost:8787 …'}
            </p>
          )}
          {state.monitors.map((monitor) => (
            <MonitorPreview
              key={monitor.key}
              monitor={monitor}
              frame={state.frames[monitor.key]}
              regions={regionsFor(monitor.key)}
              selectedRegionId={draft?.id ?? null}
              regionStatus={state.regionStatus}
              onSelectRegion={(regionId) => {
                const region = profile?.regions.find((candidate) => candidate.id === regionId);
                if (region) setDraft(structuredClone(region));
              }}
              onCreateRect={handleCreateRect}
            />
          ))}
        </div>
        <aside className="sidebar">
          <nav className="tabs">
            {(['regions', 'strategy', 'model'] as Tab[]).map((name) => (
              <button
                key={name}
                className={tab === name ? 'primary' : ''}
                onClick={() => setTab(name)}
              >
                {name}
                {name === 'model' && profile?.settings.mode === 'llm' ? ' ●' : ''}
              </button>
            ))}
          </nav>

          {tab === 'strategy' && (
            <section>
              <h2>strategy</h2>
              <StrategyPanel
                strategies={state.strategies}
                selectedId={strategy?.id ?? null}
                onSelect={setSelectedStrategyId}
                onCreate={createStrategy}
                onSave={(updated: Strategy) => send({ type: 'saveStrategy', strategy: updated })}
                onDelete={(strategyId) => {
                  send({ type: 'deleteStrategy', strategyId });
                  setSelectedStrategyId(null);
                }}
                onUpload={uploadAttachment}
                onDeleteAttachment={(strategyId, attachmentId) =>
                  send({ type: 'deleteAttachment', strategyId, attachmentId })
                }
              />
            </section>
          )}

          {tab === 'model' && (
            <section>
              <h2>model {profile ? `— ${profile.name}` : ''}</h2>
              {profile ? (
                <ModelPanel
                  settings={profile.settings}
                  strategies={state.strategies}
                  probe={state.llmProbe}
                  lastDecision={state.decisions.at(-1) ?? null}
                  onPatch={patchSettings}
                  onPatchLlm={patchLlm}
                  onProbe={() => send({ type: 'probeLlm', settings: profile.settings.llm })}
                  onTestDecision={() => send({ type: 'testDecision', profileId: profile.id })}
                />
              ) : (
                <p className="hint">Create a profile first.</p>
              )}
            </section>
          )}

          {tab === 'regions' && (
            <section>
              <h2>regions {profile ? `— ${profile.name}` : ''}</h2>
              <RegionList
                regions={profile?.regions ?? []}
                selectedRegionId={draft?.id ?? null}
                regionStatus={state.regionStatus}
                onSelect={(regionId) => {
                  const region = profile?.regions.find((candidate) => candidate.id === regionId);
                  if (region) setDraft(structuredClone(region));
                }}
                onToggleEnabled={(region) => upsertRegion({ ...region, enabled: !region.enabled })}
              />
            </section>
          )}
          {tab === 'regions' && draft && (
            <section>
              <h2>region editor</h2>
              <RegionEditor
                region={draft}
                lastBaseline={state.lastBaseline}
                onChange={setDraft}
                onSave={() => upsertRegion(draft)}
                onDelete={() => {
                  if (profile) {
                    saveProfile({
                      ...profile,
                      regions: profile.regions.filter((region) => region.id !== draft.id),
                    });
                  }
                  setDraft(null);
                }}
                onTest={() =>
                  profile &&
                  send({ type: 'testActions', profileId: profile.id, regionId: draft.id })
                }
                onCaptureBaseline={() =>
                  send({ type: 'captureBaseline', monitorKey: draft.monitorKey, rect: draft.rect })
                }
              />
            </section>
          )}
          <section>
            <h2>events</h2>
            <EventLog events={state.events} />
          </section>
        </aside>
      </main>
    </div>
  );
}
