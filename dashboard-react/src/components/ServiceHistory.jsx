import React, { useState } from 'react';
import { formatDateTime, formatNumber, getServiceName, truncate } from '../utils/formatters';

const ServiceHistory = ({ history, onFilterChange }) => {
  const [serviceFilter, setServiceFilter] = useState('');
  const [limit, setLimit] = useState(20);

  const handleServiceChange = (e) => {
    const value = e.target.value;
    setServiceFilter(value);
    onFilterChange(value, limit);
  };

  const handleLimitChange = (e) => {
    const value = parseInt(e.target.value) || 20;
    setLimit(value);
    onFilterChange(serviceFilter, value);
  };

  return (
    <section className="section history-section">
      <h2>📜 Service History</h2>
      <div className="history-controls">
        <select
          className="filter-select"
          value={serviceFilter}
          onChange={handleServiceChange}
        >
          <option value="">All Services</option>
          <option value="historical">Historical Service</option>
          <option value="current">Current Day Service</option>
        </select>
        <input
          type="number"
          className="limit-input"
          value={limit}
          onChange={handleLimitChange}
          min="1"
          max="100"
        />
      </div>
      <div className="history-table-container">
        <table className="history-table">
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Service</th>
              <th>Started At</th>
              <th>Completed At</th>
              <th>Status</th>
              <th>Calls Scraped</th>
              <th>Adjustments</th>
            </tr>
          </thead>
          <tbody>
            {!history || history.length === 0 ? (
              <tr>
                <td colSpan="7" className="loading">
                  {history === null ? 'Loading history...' : 'No history found'}
                </td>
              </tr>
            ) : (
              history.map((session) => {
                const service = session.serviceType
                  ? session.serviceType === 'historical' ? 'Historical' : 'Current Day'
                  : getServiceName(session.session_id);
                const status = session.status || 'unknown';

                return (
                  <tr key={session.id || session.session_id}>
                    <td>{truncate(session.session_id, 30)}</td>
                    <td>{service}</td>
                    <td>{formatDateTime(session.started_at)}</td>
                    <td>{session.completed_at ? formatDateTime(session.completed_at) : '-'}</td>
                    <td>
                      <span className={`status-badge ${status}`}>{status}</span>
                    </td>
                    <td>{formatNumber(session.calls_scraped || 0)}</td>
                    <td>{formatNumber(session.adjustments_scraped || 0)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default ServiceHistory;

