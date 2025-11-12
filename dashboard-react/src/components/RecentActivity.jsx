import React, { useState } from 'react';
import { formatDate, formatDateTime, formatCurrency, formatNumber, truncate } from '../utils/formatters';

const RecentActivity = ({ activity }) => {
  const [activeTab, setActiveTab] = useState('calls');

  if (!activity) {
    return (
      <section className="section activity-section">
        <h2>🕐 Recent Activity</h2>
        <div className="loading">Loading activity...</div>
      </section>
    );
  }

  const { calls, adjustments, sessions } = activity;

  return (
    <section className="section activity-section">
      <h2>🕐 Recent Activity</h2>
      <div className="activity-tabs">
        <button
          className={`tab-btn ${activeTab === 'calls' ? 'active' : ''}`}
          onClick={() => setActiveTab('calls')}
        >
          Recent Calls
        </button>
        <button
          className={`tab-btn ${activeTab === 'adjustments' ? 'active' : ''}`}
          onClick={() => setActiveTab('adjustments')}
        >
          Recent Adjustments
        </button>
        <button
          className={`tab-btn ${activeTab === 'sessions' ? 'active' : ''}`}
          onClick={() => setActiveTab('sessions')}
        >
          Recent Sessions
        </button>
      </div>
      <div className="activity-content">
        {activeTab === 'calls' && (
          <div className="tab-content active">
            <table className="activity-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Caller ID</th>
                  <th>Payout</th>
                  <th>Created At</th>
                </tr>
              </thead>
              <tbody>
                {calls.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="loading">No recent calls</td>
                  </tr>
                ) : (
                  calls.map((call) => (
                    <tr key={call.id}>
                      <td>{formatDate(call.date_of_call)}</td>
                      <td>{call.caller_id || '-'}</td>
                      <td>{formatCurrency(call.payout || 0)}</td>
                      <td>{formatDateTime(call.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'adjustments' && (
          <div className="tab-content active">
            <table className="activity-table">
              <thead>
                <tr>
                  <th>Time of Call</th>
                  <th>Caller ID</th>
                  <th>Amount</th>
                  <th>Created At</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="loading">No recent adjustments</td>
                  </tr>
                ) : (
                  adjustments.map((adj) => (
                    <tr key={adj.id}>
                      <td>{formatDateTime(adj.time_of_call)}</td>
                      <td>{adj.caller_id || '-'}</td>
                      <td>{formatCurrency(adj.amount || 0)}</td>
                      <td>{formatDateTime(adj.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="tab-content active">
            <table className="activity-table">
              <thead>
                <tr>
                  <th>Session ID</th>
                  <th>Status</th>
                  <th>Started At</th>
                  <th>Calls</th>
                  <th>Adjustments</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="loading">No recent sessions</td>
                  </tr>
                ) : (
                  sessions.map((session) => (
                    <tr key={session.id || session.session_id}>
                      <td>{truncate(session.session_id, 30)}</td>
                      <td>
                        <span className={`status-badge ${session.status}`}>{session.status}</span>
                      </td>
                      <td>{formatDateTime(session.started_at)}</td>
                      <td>{formatNumber(session.calls_scraped || 0)}</td>
                      <td>{formatNumber(session.adjustments_scraped || 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};

export default RecentActivity;

