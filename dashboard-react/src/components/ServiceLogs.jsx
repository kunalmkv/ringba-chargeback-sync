import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { formatDateTime, truncate } from '../utils/formatters';

const ServiceLogs = ({ service = null, sessionId = null, onClose = null }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('failed');
  const [expandedLogs, setExpandedLogs] = useState(new Set());

  useEffect(() => {
    loadLogs();
  }, [service, sessionId, statusFilter]);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.serviceLogs(service, sessionId, statusFilter, 100);
      setLogs(data.logs || []);
    } catch (err) {
      setError(err.message);
      console.error('Error loading service logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (logId) => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedLogs(newExpanded);
  };

  const getServiceName = (serviceType) => {
    const names = {
      'historical': 'Historical (STATIC)',
      'current': 'Current Day (STATIC)',
      'historical-api': 'Historical (API)',
      'current-api': 'Current Day (API)',
      'ringba-sync': 'Ringba Sync',
      'revenue-sync': 'Revenue Sync',
      'ringba-cost-sync': 'Ringba Cost Sync'
    };
    return names[serviceType] || serviceType || 'Unknown';
  };

  const formatContext = (context) => {
    if (!context) return null;
    return Object.entries(context)
      .filter(([key, value]) => value !== null && value !== undefined)
      .map(([key, value]) => {
        if (typeof value === 'object') {
          return `${key}: ${JSON.stringify(value, null, 2)}`;
        }
        return `${key}: ${value}`;
      })
      .join('\n');
  };

  return (
    <div className="service-logs-container">
      <div className="service-logs-header">
        <h2>🔍 Service Error Logs</h2>
        {onClose && (
          <button className="close-button" onClick={onClose}>×</button>
        )}
      </div>

      <div className="service-logs-controls">
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="failed">Failed Only</option>
          <option value="partial">Partial Failures</option>
          <option value="success">Success</option>
        </select>
        <button className="refresh-button" onClick={loadLogs} disabled={loading}>
          {loading ? 'Loading...' : '🔄 Refresh'}
        </button>
      </div>

      {error && (
        <div className="error-message">
          ❌ Error loading logs: {error}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading logs...</div>
      ) : logs.length === 0 ? (
        <div className="no-logs">
          ✅ No error logs found for the selected filters.
        </div>
      ) : (
        <div className="logs-list">
          {logs.map((log) => {
            const isExpanded = expandedLogs.has(log.id);
            const hasContext = log.context && Object.keys(log.context).length > 0;

            return (
              <div key={log.id} className={`log-entry ${log.status}`}>
                <div className="log-header" onClick={() => toggleExpand(log.id)}>
                  <div className="log-main-info">
                    <span className="log-service">{getServiceName(log.service_type)}</span>
                    <span className="log-status-badge">{log.status}</span>
                    <span className="log-timestamp">{formatDateTime(log.timestamp)}</span>
                  </div>
                  <div className="log-toggle">
                    {isExpanded ? '▼' : '▶'}
                  </div>
                </div>

                <div className="log-error-message">
                  <strong>Error:</strong> {log.error_message || 'No error message'}
                </div>

                {log.session_id && (
                  <div className="log-session-id">
                    <strong>Session ID:</strong> {truncate(log.session_id, 60)}
                  </div>
                )}

                {isExpanded && (
                  <div className="log-details">
                    {hasContext && (
                      <div className="log-context">
                        <strong>Context:</strong>
                        <pre>{formatContext(log.context)}</pre>
                      </div>
                    )}

                    {log.context?.api_request && (
                      <div className="log-api-request">
                        <strong>API Request:</strong>
                        <pre>{JSON.stringify(log.context.api_request, null, 2)}</pre>
                      </div>
                    )}

                    {log.context?.api_response && (
                      <div className="log-api-response">
                        <strong>API Response:</strong>
                        <pre>{JSON.stringify(log.context.api_response, null, 2)}</pre>
                      </div>
                    )}

                    {log.context?.lookup_result && (
                      <div className="log-lookup-result">
                        <strong>Lookup Result:</strong>
                        <pre>{JSON.stringify(log.context.lookup_result, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ServiceLogs;

