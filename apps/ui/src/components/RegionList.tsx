import type { Region } from '@autopoker/shared';
import type { RegionStatusInfo } from '../ws/useServer';

interface Props {
  regions: Region[];
  selectedRegionId: string | null;
  regionStatus: Record<string, RegionStatusInfo>;
  onSelect(regionId: string): void;
  onToggleEnabled(region: Region): void;
}

export function RegionList({
  regions,
  selectedRegionId,
  regionStatus,
  onSelect,
  onToggleEnabled,
}: Props) {
  if (regions.length === 0) {
    return <p className="hint">Drag a rectangle on a preview to register a region.</p>;
  }
  return (
    <ul className="region-list">
      {regions.map((region) => {
        const status = regionStatus[region.id];
        return (
          <li
            key={region.id}
            className={region.id === selectedRegionId ? 'selected' : ''}
            onClick={() => onSelect(region.id)}
          >
            <label onClick={(event) => event.stopPropagation()}>
              <input
                type="checkbox"
                checked={region.enabled}
                onChange={() => onToggleEnabled(region)}
              />
            </label>
            <span className="region-name">{region.name}</span>
            <span className="region-meta">{region.condition.type}</span>
            {status && (
              <span className={`status-badge ${status.matched ? 'matched' : ''} ${status.state}`}>
                {status.state}
                {status.value !== undefined ? ` ${status.value.toFixed(0)}` : ''}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
