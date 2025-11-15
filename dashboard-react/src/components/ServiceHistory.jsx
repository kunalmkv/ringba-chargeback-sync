import React, { useState } from 'react';
import { formatDateTime, formatNumber, getServiceName, truncate } from '../utils/formatters';
import ServiceLogs from './ServiceLogs';

const ServiceHistory = ({ history, onFilterChange }) => {
  const [serviceFilter, setServiceFilter] = useState('');
  const [limit, setLimit] = useState(20);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [selectedServiceForLogs, setSelectedServiceForLogs] = useState(null);

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

  const handleStatusFilterChange = (e) => {
    const value = e.target.value;
    setStatusFilter(value);
    // Filter history by status if needed
    // This will be handled by the parent component
  };

  const toggleRowExpand = (sessionId) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(sessionId)) {
      newExpanded.delete(sessionId);
    } else {
      newExpanded.add(sessionId);
    }
    setExpandedRows(newExpanded);
  };

  const handleViewLogs = (serviceType, sessionId = null) => {
    setSelectedServiceForLogs({ service: serviceType, sessionId });
    setShowLogsModal(true);
  };

  const filteredHistory = history?.filter(session => {
    if (statusFilter === 'failed') {
      return session.status === 'failed' || session.status === 'partial';
    }
    if (statusFilter === 'success') {
      return session.status === 'success' || session.status === 'completed';
    }
    return true;
  }) || [];

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
          <option value="historical">Historical (STATIC)</option>
          <option value="current">Current Day (STATIC)</option>
          <option value="historical-api">Historical (API)</option>
          <option value="current-api">Current Day (API)</option>
          <option value="ringba-sync">Ringba Sync</option>
          <option value="revenue-sync">Revenue Sync</option>
          <option value="ringba-cost-sync">Ringba Cost Sync</option>
        </select>
        <select
          className="filter-select"
          value={statusFilter}
          onChange={handleStatusFilterChange}
        >
          <option value="">All Statuses</option>
          <option value="failed">Failed Only</option>
          <option value="success">Success Only</option>
        </select>
        <input
          type="number"
          className="limit-input"
          value={limit}
          onChange={handleLimitChange}
          min="1"
          max="100"
        />
        <button 
          className="view-logs-button"
          onClick={() => handleViewLogs(serviceFilter || null)}
          title="View detailed error logs"
        >
          🔍 View Logs
        </button>
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
              <th>Items Processed</th>
              <th>Success/Details</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!history || history.length === 0 ? (
              <tr>
                <td colSpan="8" className="loading">
                  {history === null ? 'Loading history...' : 'No history found'}
                </td>
              </tr>
            ) : filteredHistory.length === 0 ? (
              <tr>
                <td colSpan="8" className="loading">
                  No sessions found matching the filters
                </td>
              </tr>
            ) : (
              filteredHistory.map((session) => {
                // Use service_name if available, otherwise derive from service_type or session_id
                const service = session.service_name || 
                  (session.service_type === 'historical' ? 'Historical (STATIC)' :
                   session.service_type === 'current' ? 'Current Day (STATIC)' :
                   session.service_type === 'historical-api' ? 'Historical (API)' :
                   session.service_type === 'current-api' ? 'Current Day (API)' :
                   session.service_type === 'ringba-sync' ? 'Ringba Sync' :
                   session.service_type === 'revenue-sync' ? 'Revenue Sync' :
                   session.service_type === 'ringba-cost-sync' ? 'Ringba Cost Sync' :
                   getServiceName(session.session_id));
                
                const status = session.status || 'unknown';
                
                // Format calls/adjustments based on service type
                let callsDisplay = formatNumber(session.calls_scraped || session.calls || 0);
                let adjustmentsDisplay = formatNumber(session.adjustments_scraped || session.adjustments || 0);
                
                // For Ringba Sync, show sync counts
                if (session.service_type === 'ringba-sync') {
                  if (session.total_syncs !== undefined) {
                    callsDisplay = `${formatNumber(session.total_syncs)} (${formatNumber(session.successful_syncs || 0)} success, ${formatNumber(session.failed_syncs || 0)} failed)`;
                  }
                }
                
                // For Revenue Sync, show days processed
                if (session.service_type === 'revenue-sync' && session.days_processed !== undefined) {
                  callsDisplay = `${formatNumber(session.days_processed)} days`;
                }
                
                // For Ringba Cost Sync, show calls processed
                if (session.service_type === 'ringba-cost-sync' && session.calls_processed !== undefined) {
                  callsDisplay = formatNumber(session.calls_processed);
                }

                const isExpanded = expandedRows.has(session.id || session.session_id);
                const hasError = session.error_message || (session.failed_syncs && session.failed_syncs > 0);

                return (
                  <React.Fragment key={session.id || session.session_id}>
                    <tr className={hasError ? 'has-error' : ''}>
                      <td>
                        <button
                          className="expand-button"
                          onClick={() => toggleRowExpand(session.id || session.session_id)}
                          disabled={!hasError}
                          title={hasError ? 'Click to view error details' : 'No errors'}
                        >
                          {hasError ? (isExpanded ? '▼' : '▶') : '•'}
                        </button>
                        {truncate(session.session_id, 40)}
                      </td>
                      <td>{service}</td>
                      <td>{formatDateTime(session.started_at)}</td>
                      <td>{session.completed_at ? formatDateTime(session.completed_at) : '-'}</td>
                      <td>
                        <span className={`status-badge ${status}`}>{status}</span>
                      </td>
                      <td>{callsDisplay}</td>
                      <td>{adjustmentsDisplay}</td>
                      <td>
                        {hasError && (
                          <button
                            className="view-logs-link"
                            onClick={() => handleViewLogs(session.service_type, session.session_id)}
                            title="View detailed error logs"
                          >
                            View Logs
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && hasError && (
                      <tr className="error-details-row">
                        <td colSpan="8" className="error-details-cell">
                          <div className="error-details-content">
                            <strong>Error Details:</strong>
                            <div className="error-message-text">
                              {session.error_message || 'No error message available'}
                            </div>
                            {session.error_samples && session.error_samples.length > 0 && (
                              <div className="error-samples">
                                <strong>Sample Errors:</strong>
                                <ul>
                                  {session.error_samples.map((err, idx) => (
                                    <li key={idx}>{err}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {session.failed_syncs > 0 && (
                              <div className="error-stats">
                                <strong>Failure Stats:</strong>
                                <ul>
                                  <li>Total Failed: {session.failed_syncs}</li>
                                  <li>Total Successful: {session.successful_syncs || 0}</li>
                                  <li>Total Syncs: {session.total_syncs || 0}</li>
                                </ul>
                              </div>
                            )}
                            <button
                              className="view-full-logs-button"
                              onClick={() => handleViewLogs(session.service_type, session.session_id)}
                            >
                              View Full Error Logs →
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showLogsModal && (
        <div className="logs-modal-overlay" onClick={() => setShowLogsModal(false)}>
          <div className="logs-modal-content" onClick={(e) => e.stopPropagation()}>
            <ServiceLogs
              service={selectedServiceForLogs?.service}
              sessionId={selectedServiceForLogs?.sessionId}
              onClose={() => setShowLogsModal(false)}
            />
          </div>
        </div>
      )}
    </section>
  );
};

export default ServiceHistory;

