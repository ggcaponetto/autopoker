import { useState } from 'react';
import type { EngineState, Profile } from '@autopoker/shared';

interface Props {
  connected: boolean;
  engineState: EngineState;
  profiles: Profile[];
  selectedProfileId: string | null;
  onSelectProfile(profileId: string): void;
  onCreateProfile(name: string): void;
  onStart(): void;
  onStop(): void;
  onSetDryRun(enabled: boolean): void;
}

export function EngineControls({
  connected,
  engineState,
  profiles,
  selectedProfileId,
  onSelectProfile,
  onCreateProfile,
  onStart,
  onStop,
  onSetDryRun,
}: Props) {
  const [newName, setNewName] = useState('');
  const live = !engineState.dryRun;

  return (
    <div className="engine-controls">
      <span className={`pill ${connected ? 'ok' : 'bad'}`}>
        {connected ? 'connected' : 'disconnected'}
      </span>
      <select
        value={selectedProfileId ?? ''}
        onChange={(event) => onSelectProfile(event.target.value)}
        disabled={profiles.length === 0}
      >
        {profiles.length === 0 && <option value="">no profiles</option>}
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
      <input
        placeholder="new profile name"
        value={newName}
        onChange={(event) => setNewName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && newName.trim()) {
            onCreateProfile(newName.trim());
            setNewName('');
          }
        }}
      />
      <button
        onClick={() => {
          if (newName.trim()) {
            onCreateProfile(newName.trim());
            setNewName('');
          }
        }}
      >
        + profile
      </button>
      {engineState.running ? (
        <button className="danger" onClick={onStop}>
          ■ stop
        </button>
      ) : (
        <button className="primary" onClick={onStart} disabled={!connected || !selectedProfileId}>
          ▶ start
        </button>
      )}
      <label className={`live-toggle ${live ? 'live' : ''}`}>
        <input
          type="checkbox"
          checked={live}
          onChange={(event) => onSetDryRun(!event.target.checked)}
        />
        {live ? 'LIVE — mouse/keyboard will act' : 'dry-run (log only)'}
      </label>
      {engineState.running && (
        <span className="pill ok">
          running · {engineState.intervalMs}ms
          {engineState.killSwitchArmed ? ' · Esc to halt' : ''}
        </span>
      )}
    </div>
  );
}
