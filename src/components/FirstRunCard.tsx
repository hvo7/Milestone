import { useNavigate } from 'react-router-dom';
import { useQuestStore } from '../store';

export default function FirstRunCard() {
  const navigate = useNavigate();
  const loadSampleData = useQuestStore(s => s.loadSampleData);
  return (
    <div className="agenda-empty">
      <p>No tasks scheduled for today.</p>
      <button type="button" className="agenda-text-action" onClick={() => {
        loadSampleData();
        navigate('/quests');
      }}>Explore example questlines</button>
    </div>
  );
}
