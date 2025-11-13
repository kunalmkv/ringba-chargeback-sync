import React from 'react';
import { useDashboardData } from './hooks/useDashboardData';
import Header from './components/Header';
import HealthStatus from './components/HealthStatus';
import Statistics from './components/Statistics';
import RingbaStatus from './components/RingbaStatus';
import ServiceHistory from './components/ServiceHistory';
import RecentActivity from './components/RecentActivity';
import ChargebackTracker from './components/ChargebackTracker';
import Footer from './components/Footer';

function App() {
  const {
    health,
    stats,
    history,
    activity,
    chargeback,
    loading,
    error,
    lastUpdated,
    loadAllData,
    loadHistory
  } = useDashboardData();

  const getStatusInfo = () => {
    if (loading) return { status: 'Loading...', type: 'warning' };
    if (error) return { status: `Error: ${error}`, type: 'error' };
    if (health?.status === 'healthy') return { status: 'Healthy', type: 'healthy' };
    return { status: 'Checking...', type: 'warning' };
  };

  const statusInfo = getStatusInfo();

  const handleHistoryFilter = (service, limit) => {
    loadHistory(service || null, limit);
  };

  return (
    <div className="dashboard-container">
      <Header
        status={statusInfo.status}
        statusType={statusInfo.type}
        onRefresh={loadAllData}
        lastUpdated={lastUpdated}
      />

      <main className="dashboard-main">
        <HealthStatus health={health} />
        <Statistics stats={stats} />
        <RingbaStatus stats={stats} />
        <ChargebackTracker chargebackData={chargeback} loading={loading} />
        <ServiceHistory history={history} onFilterChange={handleHistoryFilter} />
        <RecentActivity activity={activity} />
      </main>

      <Footer lastUpdated={lastUpdated} />
    </div>
  );
}

export default App;

