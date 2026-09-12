import { Navigate, useParams } from 'react-router-dom';
import { questlineHref } from '../lib/questlineNavigation';

/** Preserve existing questline bookmarks while opening the shared workspace. */
export default function QuestlinePage() {
  const { id } = useParams<{ id: string }>();
  return <Navigate replace to={id ? questlineHref('quests', id) : '/quests'} />;
}
