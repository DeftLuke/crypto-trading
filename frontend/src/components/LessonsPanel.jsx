import { useEffect, useState } from 'react';
import { fetchSkippedLessons, fetchExecutedLessons, fetchLessonStats } from '../services/api';

function LessonCard({ lesson }) {
  const outcomeClass = lesson.outcome === 'win' ? 'trade-pnl-positive'
    : lesson.outcome === 'loss' ? 'trade-pnl-negative' : '';

  return (
    <div className="lesson-card">
      <div className="lesson-header">
        <span className="signal-symbol">{lesson.symbol} {lesson.direction}</span>
        <span className={`confidence-badge ${lesson.outcome === 'win' ? 'confidence-high' : lesson.outcome === 'loss' ? 'confidence-low' : 'confidence-mid'}`}>
          {lesson.outcome?.toUpperCase()} {lesson.win_probability ? `${lesson.win_probability}%` : ''}
        </span>
      </div>
      <p className="signal-detail">{lesson.setup_description}</p>
      <p className="lesson-text">{lesson.lesson_text}</p>
      <div className="lesson-meta">
        {new Date(lesson.created_at).toLocaleString()} · {lesson.ai_model || 'AI'}
      </div>
    </div>
  );
}

export default function SkippedLessonsPanel() {
  const [lessons, setLessons] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  async function load() {
    try {
      const [data, s] = await Promise.all([fetchSkippedLessons(), fetchLessonStats()]);
      setLessons(Array.isArray(data) ? data : []);
      setStats(s);
    } catch {
      setLessons([]);
    }
  }

  const skippedStats = stats?.skipped;

  return (
    <div className="panel lessons-panel skipped-panel">
      <h3>⏭ Skipped Trade Lessons</h3>
      {skippedStats && (
        <div className="lesson-stats-bar">
          <span className="trade-pnl-positive">Wins: {skippedStats.wins}</span>
          <span className="trade-pnl-negative">Losses: {skippedStats.losses}</span>
          <span>Total: {skippedStats.total}</span>
          {skippedStats.total > 0 && (
            <span>Skip accuracy: {Math.round((skippedStats.wins / skippedStats.total) * 100)}% would have won</span>
          )}
        </div>
      )}
      {lessons.length === 0 && (
        <p className="signal-detail">No skipped trade lessons yet. Skip a signal — outcome checked at 15/20 min.</p>
      )}
      {lessons.map((l) => <LessonCard key={l.id} lesson={l} />)}
    </div>
  );
}

export function ExecutedLessonsPanel() {
  const [lessons, setLessons] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  async function load() {
    try {
      const [data, s] = await Promise.all([fetchExecutedLessons(), fetchLessonStats()]);
      setLessons(Array.isArray(data) ? data : []);
      setStats(s);
    } catch {
      setLessons([]);
    }
  }

  const execStats = stats?.executed;

  return (
    <div className="panel lessons-panel executed-panel">
      <h3>✅ Real Trade Lessons</h3>
      {execStats && (
        <div className="lesson-stats-bar">
          <span className="trade-pnl-positive">Wins: {execStats.wins}</span>
          <span className="trade-pnl-negative">Losses: {execStats.losses}</span>
          <span>Total: {execStats.total}</span>
          {execStats.total > 0 && (
            <span>Win rate: {Math.round((execStats.wins / execStats.total) * 100)}%</span>
          )}
        </div>
      )}
      {lessons.length === 0 && (
        <p className="signal-detail">No executed trade lessons yet. Lessons appear after real trades close.</p>
      )}
      {lessons.map((l) => <LessonCard key={l.id} lesson={l} />)}
    </div>
  );
}
