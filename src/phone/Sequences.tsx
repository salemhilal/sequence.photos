import { useEffect, useState } from 'react';
import { Ellipsis, Plus } from 'lucide-react';
import { createProject, deleteProject, editedLabel, listProjects, renameProject, type LibraryEntry } from './library';
import { FrameView } from './FrameView';
import { openSequence } from './nav';
import { ActionSheet } from './Sheets';
import { RenameSheet } from './RenameSheet';

/** Sequences: every project on the phone, most recently changed first. */
export function Sequences() {
  const [list, setList] = useState<LibraryEntry[] | null>(null);
  const [menu, setMenu] = useState<LibraryEntry | null>(null);
  const [renaming, setRenaming] = useState<LibraryEntry | null>(null);
  const [confirming, setConfirming] = useState<LibraryEntry | null>(null);
  const reload = () => void listProjects().then(setList);
  useEffect(reload, []);

  const create = async () => {
    const id = await createProject();
    const entry = (await listProjects()).find((e) => e.id === id);
    if (entry) await openSequence(entry);
  };

  return (
    <div className="screen">
      <div className="nav" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" aria-label="New sequence" onClick={() => void create()}>
          <Plus />
        </button>
      </div>
      <div className="title">
        <h1 className="large">Sequences</h1>
      </div>
      <div className="scroll">
        {list && list.length === 0 && (
          <div className="empty">
            No sequences yet.
            <button className="btn raised" onClick={() => void create()}>
              <Plus /> New sequence
            </button>
          </div>
        )}
        <div className="rows">
          {list?.map((e) => (
            <div key={e.id} className="row">
              <button className="row-open" onClick={() => void openSequence(e)}>
                <div className="row-thumbs">
                  {e.cover.frames.map((f) => (
                    <FrameView
                      key={f.id}
                      frame={f}
                      page={e.page}
                      photos={e.cover.photos}
                      width={e.page.w >= e.page.h ? 80 : (50 * e.page.w) / e.page.h}
                    />
                  ))}
                </div>
                <div className="row-text">
                  <span className="row-name">{e.name}</span>
                  <span className="row-meta">
                    {e.frameCount} {e.frameCount === 1 ? 'frame' : 'frames'} · {e.page.w} × {e.page.h} px
                  </span>
                  <span className="row-date">{editedLabel(e.updated)}</span>
                </div>
              </button>
              <button className="btn" aria-label={`More for ${e.name}`} onClick={() => setMenu(e)}>
                <Ellipsis />
              </button>
            </div>
          ))}
        </div>
      </div>
      {menu && (
        <ActionSheet
          title={menu.name}
          onCancel={() => setMenu(null)}
          actions={[
            { label: 'Rename', run: () => (setRenaming(menu), setMenu(null)) },
            { label: 'Delete', danger: true, run: () => (setConfirming(menu), setMenu(null)) },
          ]}
        />
      )}
      {confirming && (
        <ActionSheet
          title={`Delete “${confirming.name}”? Its frames and photos go too. This can’t be undone.`}
          onCancel={() => setConfirming(null)}
          actions={[
            {
              label: 'Delete sequence',
              danger: true,
              run: () => {
                const id = confirming.id;
                setConfirming(null);
                void deleteProject(id).then(reload);
              },
            },
          ]}
        />
      )}
      {renaming && (
        <RenameSheet
          name={renaming.name}
          onCancel={() => setRenaming(null)}
          onDone={(name) => {
            const id = renaming.id;
            setRenaming(null);
            void renameProject(id, name).then(reload);
          }}
        />
      )}
    </div>
  );
}
