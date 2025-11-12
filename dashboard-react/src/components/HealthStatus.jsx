import React from 'react';
import { formatRelativeTime, getStatusClass } from '../utils/formatters';

const HealthStatus = ({ health }) => {
  if (!health || !health.services) {
    return (
      <section className="section health-section">
        <h2>🏥 Service Health Status</h2>
        <div className="loading">Loading health status...</div>
      </section>
    );
  }

  const { historical, current, ringba } = health.services;

  const ServiceCard = ({ icon, title, serviceData }) => {
    const status = serviceData?.status || serviceData?.lastStatus || 'unknown';
    const lastRun = serviceData?.lastRun || null;
    const statusClass = getStatusClass(status);

    return (
      <div className="health-card">
        <div className="health-icon">{icon}</div>
        <div className="health-info">
          <h3>{title}</h3>
          <p className={`health-status ${statusClass}`}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </p>
          <p className="health-time">
            {lastRun ? formatRelativeTime(new Date(lastRun)) : 'Never'}
          </p>
        </div>
      </div>
    );
  };

  return (
    <section className="section health-section">
      <h2>🏥 Service Health Status</h2>
      <div className="health-grid">
        <ServiceCard icon="📅" title="Historical Service" serviceData={historical} />
        <ServiceCard icon="⚡" title="Current Day Service" serviceData={current} />
        <ServiceCard icon="🔄" title="Ringba Sync" serviceData={ringba} />
        <div className="health-card">
          <div className="health-icon">🔐</div>
          <div className="health-info">
            <h3>Auth Service</h3>
            <p className="health-status success">Active</p>
            <p className="health-time">Session valid</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HealthStatus;

