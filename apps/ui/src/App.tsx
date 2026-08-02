import { useEffect, useMemo, useState } from 'react';
import {
  createDefaultSettings,
  ProfileSchema,
  RegionSchema,
  type Profile,
  type Rect,
  type Region,
} from '@autopoker/shared';
import { EngineControls } from './components/EngineControls';
import { EventLog } from './components/EventLog';
import { MonitorPreview } from './components/MonitorPreview';
import { RegionEditor } from './components/RegionEditor';
import { RegionList } from './components/RegionList';
import { useServer } from './ws/useServer';

export function App() {
  const { state, send, subscribe } = useServer();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Region | null>(null);

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
          {draft && (
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
