import { useEffect, useRef, useState } from 'react';
import type { Strategy } from '@autopoker/shared';

interface Props {
  strategies: Strategy[];
  selectedId: string | null;
  onSelect(strategyId: string): void;
  onCreate(name: string): void;
  onSave(strategy: Strategy): void;
  onDelete(strategyId: string): void;
  onUpload(strategyId: string, file: File): void;
  onDeleteAttachment(strategyId: string, attachmentId: string): void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function StrategyPanel({
  strategies,
  selectedId,
  onSelect,
  onCreate,
  onSave,
  onDelete,
  onUpload,
  onDeleteAttachment,
}: Props) {
  const selected = strategies.find((strategy) => strategy.id === selectedId) ?? null;
  const [draft, setDraft] = useState<Strategy | null>(selected);
  const [newName, setNewName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  // Re-sync the editor when a different strategy is chosen or the server sends an update
  // (an attachment upload rewrites the strategy), but keep unsaved markdown edits.
  const syncedId = useRef<string | null>(null);
  const syncedStamp = useRef<number>(0);
  useEffect(() => {
    if (!selected) {
      if (syncedId.current !== null) {
        syncedId.current = null;
        setDraft(null);
      }
      return;
    }
    if (selected.id !== syncedId.current || selected.updatedAt !== syncedStamp.current) {
      syncedId.current = selected.id;
      syncedStamp.current = selected.updatedAt;
      setDraft(selected);
    }
  }, [selected]);

  const dirty =
    draft !== null &&
    selected !== null &&
    (draft.markdown !== selected.markdown ||
      draft.name !== selected.name ||
      draft.description !== selected.description);

  return (
    <div className="panel">
      <div className="row">
        <select value={selectedId ?? ''} onChange={(event) => onSelect(event.target.value)}>
          {strategies.length === 0 && <option value="">no strategies</option>}
          {strategies.map((strategy) => (
            <option key={strategy.id} value={strategy.id}>
              {strategy.name}
            </option>
          ))}
        </select>
        <input
          placeholder="new strategy name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && newName.trim()) {
              onCreate(newName.trim());
              setNewName('');
            }
          }}
        />
        <button
          onClick={() => {
            if (newName.trim()) {
              onCreate(newName.trim());
              setNewName('');
            }
          }}
        >
          + strategy
        </button>
      </div>

      {!draft && <p className="hint">Create a strategy to tell the model how to play.</p>}

      {draft && (
        <>
          <div className="row">
            <label className="field grow">
              <span>name</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
          </div>
          <label className="field grow">
            <span>summary</span>
            <input
              value={draft.description}
              placeholder="one line describing the game or app"
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>

          <label className="field-block">
            <span>strategy (markdown — sent to the model verbatim)</span>
            <textarea
              className="markdown-editor"
              value={draft.markdown}
              spellCheck={false}
              placeholder={
                '# When it is my turn\n\n- If the pot is small, fold weak hands.\n- Click "Fold button" to fold.'
              }
              onChange={(event) => setDraft({ ...draft, markdown: event.target.value })}
            />
          </label>

          <fieldset>
            <legend>reference material</legend>
            {draft.attachments.length === 0 && (
              <p className="hint">
                Attach images, PDFs or text files — range charts, rules, screenshots of what to look
                for.
              </p>
            )}
            <ul className="attachment-list">
              {draft.attachments.map((attachment) => (
                <li key={attachment.id}>
                  <span className={`pill kind-${attachment.kind}`}>{attachment.kind}</span>
                  <span className="grow">{attachment.filename}</span>
                  <span className="region-meta">{formatBytes(attachment.sizeBytes)}</span>
                  <button onClick={() => onDeleteAttachment(draft.id, attachment.id)}>✕</button>
                </li>
              ))}
            </ul>
            <div className="row">
              <input
                ref={fileInput}
                type="file"
                accept="image/*,application/pdf,text/*,.md,.txt,.csv,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(draft.id, file);
                  if (fileInput.current) fileInput.current.value = '';
                }}
              />
            </div>
          </fieldset>

          <div className="row">
            <button className="primary" onClick={() => onSave(draft)} disabled={!dirty}>
              {dirty ? 'save strategy' : 'saved'}
            </button>
            <button className="danger" onClick={() => onDelete(draft.id)}>
              delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
