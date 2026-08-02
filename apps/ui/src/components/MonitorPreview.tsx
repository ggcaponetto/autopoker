import { useRef, useState } from 'react';
import type { MonitorInfo, Point, Rect, Region } from '@autopoker/shared';
import { clientToCapture, rectFromDrag, rectToCss } from '../lib/coords';
import type { FrameInfo, RegionStatusInfo } from '../ws/useServer';

interface Props {
  monitor: MonitorInfo;
  frame: FrameInfo | undefined;
  regions: Region[];
  selectedRegionId: string | null;
  regionStatus: Record<string, RegionStatusInfo>;
  onSelectRegion(regionId: string): void;
  onCreateRect(monitorKey: string, rect: Rect): void;
}

export function MonitorPreview({
  monitor,
  frame,
  regions,
  selectedRegionId,
  regionStatus,
  onSelectRegion,
  onCreateRect,
}: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragRect, setDragRect] = useState<Rect | null>(null);

  const capturePoint = (event: React.MouseEvent): Point | null => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    return clientToCapture(
      event.clientX,
      event.clientY,
      surface.getBoundingClientRect(),
      monitor.captureWidth,
      monitor.captureHeight,
    );
  };

  const endDrag = (event: React.MouseEvent) => {
    if (dragStart) {
      const end = capturePoint(event);
      const rect = end && rectFromDrag(dragStart, end);
      if (rect) onCreateRect(monitor.key, rect);
    }
    setDragStart(null);
    setDragRect(null);
  };

  return (
    <section className="monitor">
      <header className="monitor-title">
        <strong>{monitor.key}</strong>
        <span>
          {monitor.captureWidth}×{monitor.captureHeight}
          {monitor.isPrimary ? ' · primary' : ''}
        </span>
      </header>
      <div
        className="preview-surface"
        ref={surfaceRef}
        onMouseDown={(event) => {
          if (!frame || event.button !== 0) return;
          setDragStart(capturePoint(event));
        }}
        onMouseMove={(event) => {
          if (!dragStart) return;
          const current = capturePoint(event);
          setDragRect(current ? rectFromDrag(dragStart, current, 1) : null);
        }}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame.jpegBase64}`}
            alt={`preview of ${monitor.key}`}
            draggable={false}
          />
        ) : (
          <div className="no-frame">waiting for preview…</div>
        )}
        {regions.map((region) => {
          const status = regionStatus[region.id];
          const classes = ['region-box'];
          if (region.id === selectedRegionId) classes.push('selected');
          if (!region.enabled) classes.push('disabled');
          if (status?.matched) classes.push('matched');
          if (status?.state === 'cooldown') classes.push('cooldown');
          return (
            <div
              key={region.id}
              className={classes.join(' ')}
              style={rectToCss(region.rect, monitor.captureWidth, monitor.captureHeight)}
              title={region.name}
              onMouseDown={(event) => {
                event.stopPropagation();
                onSelectRegion(region.id);
              }}
            >
              <span>{region.name}</span>
            </div>
          );
        })}
        {dragRect && (
          <div
            className="region-box dragging"
            style={rectToCss(dragRect, monitor.captureWidth, monitor.captureHeight)}
          />
        )}
      </div>
    </section>
  );
}
