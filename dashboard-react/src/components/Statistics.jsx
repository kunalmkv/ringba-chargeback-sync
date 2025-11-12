import React from 'react';
import { formatNumber, formatCurrency } from '../utils/formatters';

const Statistics = ({ stats }) => {
  if (!stats) {
    return (
      <section className="section stats-section">
        <h2>📈 Statistics Overview</h2>
        <div className="loading">Loading statistics...</div>
      </section>
    );
  }

  const StatCard = ({ icon, value, label }) => (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-content">
        <h3>{value}</h3>
        <p>{label}</p>
      </div>
    </div>
  );

  return (
    <section className="section stats-section">
      <h2>📈 Statistics Overview</h2>
      <div className="stats-grid">
        <StatCard icon="📞" value={formatNumber(stats.totalCalls)} label="Total Calls" />
        <StatCard icon="💰" value={formatCurrency(stats.totalPayout)} label="Total Payout" />
        <StatCard icon="📊" value={formatNumber(stats.totalAdjustments)} label="Total Adjustments" />
        <StatCard icon="✅" value={`${stats.ringba?.successRate || 0}%`} label="Success Rate" />
        <StatCard icon="📅" value={formatNumber(stats.callsToday)} label="Calls Today" />
        <StatCard icon="📆" value={formatNumber(stats.callsThisWeek)} label="Calls This Week" />
      </div>
    </section>
  );
};

export default Statistics;

