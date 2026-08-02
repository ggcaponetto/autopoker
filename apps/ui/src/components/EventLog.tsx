import type { UiEvent } from '../ws/useServer';

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

export function EventLog({ events }: { events: UiEvent[] }) {
  return (
    <div className="event-log">
      {events.length === 0 && <p className="hint">Trigger and engine events appear here.</p>}
      {[...events].reverse().map((event, index) => (
        <div
          key={`${event.at}-${index}`}
          className={`event level-${event.level} kind-${event.kind}`}
        >
          <span className="event-time">{formatTime(event.at)}</span>
          <span>{event.text}</span>
        </div>
      ))}
    </div>
  );
}
