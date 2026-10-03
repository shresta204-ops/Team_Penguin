import { useEffect, useState } from 'react';
import { getCurrentUser, getStats } from '../api/user';
import ProfileCard from './ProfileCard';
import StatsGrid from './StatsGrid';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState([]);
  useEffect(() => {
    getCurrentUser().then(setUser);
    getStats().then(setStats);
  }, []);

  if (!user) return <p className="loading">Loading your dashboard...</p>;
  return (
    <main className="dashboard">
      <h2 className="welcome">{`Welcome back, ${user.fullname}!`}</h2>
      <p className="subtitle">Here is what happened in your projects this week.</p>
      <div className="dashboard-grid">
        <ProfileCard user={user} />
        <StatsGrid stats={stats} />
      </div>
    </main>
  );
}
