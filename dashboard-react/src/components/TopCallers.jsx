import React from 'react';
import { formatNumber, formatCurrency } from '../utils/formatters';

const TopCallers = ({ topCallers }) => {
  if (!topCallers || topCallers.length === 0) {
    return (
      <section className="section top-callers-section">
        <h2>👥 Top Callers</h2>
        <div className="loading">Loading top callers...</div>
      </section>
    );
  }

  const getRankClass = (rank) => {
    if (rank === 1) return 'gold';
    if (rank === 2) return 'silver';
    if (rank === 3) return 'bronze';
    return '';
  };

  return (
    <section className="section top-callers-section">
      <h2>👥 Top Callers</h2>
      <div className="top-callers-table-container">
        <table className="top-callers-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Caller ID</th>
              <th>Call Count</th>
              <th>Total Payout</th>
            </tr>
          </thead>
          <tbody>
            {topCallers.map((caller, index) => {
              const rank = index + 1;
              const rankClass = getRankClass(rank);

              return (
                <tr key={caller.caller_id || index}>
                  <td>
                    <span className={`rank-badge ${rankClass}`}>{rank}</span>
                  </td>
                  <td>{caller.caller_id || '-'}</td>
                  <td>{formatNumber(caller.call_count || 0)}</td>
                  <td>{formatCurrency(caller.total_payout || 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default TopCallers;

