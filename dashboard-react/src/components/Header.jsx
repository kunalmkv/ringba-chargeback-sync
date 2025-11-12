import React from 'react';

const Header = ({ status, statusType, onRefresh, lastUpdated }) => {
  const getStatusDotClass = () => {
    if (statusType === 'healthy') return 'healthy';
    if (statusType === 'error') return 'error';
    return '';
  };

  return (
    <header className="dashboard-header">
      <div className="header-content">
        <h1>📊 eLocal Scraper Dashboard</h1>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={onRefresh}>
            🔄 Refresh
          </button>
          <div className="status-indicator">
            <span className={`status-dot ${getStatusDotClass()}`}></span>
            <span>{status || 'Loading...'}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;

