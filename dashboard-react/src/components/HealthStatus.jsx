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

  const { historical, historicalAPI, current, currentAPI, ringba } = health.services;

  const ServiceCard = ({ icon, title, serviceData }) => {
    const status = serviceData?.status || serviceData?.lastStatus || 'unknown';
    const lastRun = serviceData?.lastRun || null;
    const errorMessage = serviceData?.errorMessage || null;
    const statusClass = getStatusClass(status);
    const [showError, setShowError] = React.useState(false);

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
          {errorMessage && status === 'failed' && (
            <div className="error-details">
              <button 
                className="error-toggle"
                onClick={() => setShowError(!showError)}
                title="Click to view error details"
              >
                {showError ? '▼' : '▶'} Error Details
              </button>
              {showError && (
                <div className="error-message">
                  <pre>{errorMessage}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="section health-section">
      <h2>🏥 Service Health Status</h2>
      <div className="health-grid">
        <ServiceCard icon="📅" title="Historical Service (STATIC)" serviceData={historical} />
        <ServiceCard icon="📅" title="Historical Service (API)" serviceData={historicalAPI} />
        <ServiceCard icon="⚡" title="Current Day Service (STATIC)" serviceData={current} />
        <ServiceCard icon="⚡" title="Current Day Service (API)" serviceData={currentAPI} />
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

