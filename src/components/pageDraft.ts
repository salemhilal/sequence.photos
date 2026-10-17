import { useState } from 'react';
import { draftOf, type PageDraft } from '../pageSetup';
import { useProject } from '../store';

/**
 * A draft of the page's settings, kept until Apply. It starts over from the project
 * whenever the project's page changes some other way (Apply, undo, another copy's Apply).
 */
export function usePageDraft(): [PageDraft, (d: PageDraft) => void] {
  const { project } = useProject();
  const current = draftOf(project);
  const key = JSON.stringify(current);
  const [state, setState] = useState({ key, draft: current });
  if (state.key !== key) setState({ key, draft: current });
  const draft = state.key === key ? state.draft : current;
  return [draft, (d) => setState({ key, draft: d })];
}
