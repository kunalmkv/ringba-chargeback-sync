import React from 'react';
import { formatNumber } from '../utils/formatters';

const RingbaStatus = ({ stats }) => {
  if (!stats || !stats.ringba) {
    return (
      <section className="section ringba-section">
        <h2>🔄 Ringba Sync Status</h2>
        <div className="loading">Loading Ringba status...</div>
      </section>
    );
  }

  const { ringba } = stats;

  return (
    <section className="section ringba-section">
      <h2>🔄 Ringba Sync Status</h2>
      <div className="ringba-stats">
        <div className="ringba-stat">
          <span className="ringba-label">Total Synced:</span>
          <span className="ringba-value">{formatNumber(ringba.total)}</span>
        </div>
        <div className="ringba-stat">
          <span className="ringba-label">Successful:</span>
          <span className="ringba-value success">{formatNumber(ringba.success)}</span>
        </div>
        <div className="ringba-stat">
          <span className="ringba-label">Failed:</span>
          <span className="ringba-value error">{formatNumber(ringba.failed)}</span>
        </div>
        <div className="ringba-stat">
          <span className="ringba-label">Pending:</span>
          <span className="ringba-value warning">{formatNumber(ringba.pending)}</span>
        </div>
        <div className="ringba-stat">
          <span className="ringba-label">Success Rate:</span>
          <span className="ringba-value">{ringba.successRate}%</span>
        </div>
      </div>
    </section>
  );
};

export default RingbaStatus;

