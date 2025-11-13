import React from 'react';
import { formatCurrency, formatNumber, formatDate } from '../utils/formatters';
import ChargebackCharts from './ChargebackCharts';
import { generateChargebackPDF } from '../utils/pdfGenerator';

const ChargebackTracker = ({ chargebackData, loading }) => {
  if (loading) {
    return (
      <section className="section chargeback-section">
        <h2>💰 Chargeback Tracking</h2>
        <div className="loading">Loading chargeback data...</div>
      </section>
    );
  }

  if (!chargebackData || !chargebackData.rows || chargebackData.rows.length === 0) {
    return (
      <section className="section chargeback-section">
        <h2>💰 Chargeback Tracking</h2>
        <div className="no-data">No chargeback data available</div>
      </section>
    );
  }

  const { rows, summary } = chargebackData;

  const handleDownloadPDF = () => {
    try {
      generateChargebackPDF(chargebackData);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF: ' + error.message);
    }
  };

  return (
    <section className="section chargeback-section">
      <div className="chargeback-header">
        <h2>💰 Chargeback Tracking</h2>
        <button 
          className="btn btn-download" 
          onClick={handleDownloadPDF}
          title="Download PDF Report"
        >
          📥 Download PDF
        </button>
      </div>
      
      {/* Summary Cards */}
      {summary && (
        <div className="chargeback-summary">
          <div className="summary-card">
            <div className="summary-label">Total Adjustments</div>
            <div className={`summary-value ${summary.totalAdjustments < 0 ? 'negative' : 'positive'}`}>
              {formatCurrency(summary.totalAdjustments)}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Adjustment %</div>
            <div className={`summary-value ${summary.adjustmentPercentage < 0 ? 'negative' : 'positive'}`}>
              {summary.adjustmentPercentage.toFixed(2)}%
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Total Ringba</div>
            <div className="summary-value">{formatCurrency(summary.totalRingba)}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Total Elocal</div>
            <div className="summary-value">{formatCurrency(summary.totalElocal)}</div>
          </div>
        </div>
      )}

      {/* Charts Section */}
      <ChargebackCharts chargebackData={chargebackData} />

      {/* Data Table */}
      <div className="chargeback-table-container">
        <table className="chargeback-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Ringba Static</th>
              <th>Ringba API</th>
              <th>Elocal Static</th>
              <th>Elocal API</th>
              <th>Total</th>
              <th>Adjustments</th>
              <th>Adjustment (Static)</th>
              <th>Adjustment (API)</th>
              <th>Adjustment %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const ringbaStatic = parseFloat(row.ringba_static || 0);
              const ringbaApi = parseFloat(row.ringba_api || 0);
              const elocalStatic = parseFloat(row.elocal_static || 0);
              const elocalApi = parseFloat(row.elocal_api || 0);
              
              const ringbaTotal = ringbaStatic + ringbaApi;
              const elocalTotal = elocalStatic + elocalApi;
              const total = ringbaTotal; // Total column shows Ringba Total
              
              // Adjustments = Ringba Total - Elocal Total (F4 - G4)
              const adjustments = ringbaTotal - elocalTotal;
              
              // Adjustment (Static) = (Ringba Static - Elocal Static) / 100 (B4 - D4) / 100
              const adjustmentStatic = (ringbaStatic - elocalStatic) / 100;
              
              // Adjustment (API) = (Ringba API - Elocal API) / 100 (C4 - E4) / 100
              const adjustmentApi = (ringbaApi - elocalApi) / 100;
              
              // Adjustment % = Adjustments / Ringba Total * 100
              const adjustmentPercentage = ringbaTotal !== 0 
                ? (adjustments / ringbaTotal) * 100 
                : 0;

              return (
                <tr key={row.date || index}>
                  <td>{formatDate(row.date)}</td>
                  <td>{formatCurrency(ringbaStatic)}</td>
                  <td>{formatCurrency(ringbaApi)}</td>
                  <td>{formatCurrency(elocalStatic)}</td>
                  <td>{formatCurrency(elocalApi)}</td>
                  <td className="total-column">{formatCurrency(total)}</td>
                  <td className={adjustments < 0 ? 'negative' : adjustments > 0 ? 'positive' : ''}>
                    {formatCurrency(adjustments)}
                  </td>
                  <td className={adjustmentStatic < 0 ? 'negative' : adjustmentStatic > 0 ? 'positive' : ''}>
                    {(adjustmentStatic * 100).toFixed(2)}%
                  </td>
                  <td className={adjustmentApi < 0 ? 'negative' : adjustmentApi > 0 ? 'positive' : ''}>
                    {(adjustmentApi * 100).toFixed(2)}%
                  </td>
                  <td className={adjustmentPercentage < 0 ? 'negative' : adjustmentPercentage > 0 ? 'positive' : ''}>
                    {adjustmentPercentage.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
          {summary && (
            <tfoot>
              <tr className="summary-row">
                <td><strong>Total</strong></td>
                <td><strong>{formatCurrency(summary.totalRingbaStatic)}</strong></td>
                <td><strong>{formatCurrency(summary.totalRingbaApi)}</strong></td>
                <td><strong>{formatCurrency(summary.totalElocalStatic)}</strong></td>
                <td><strong>{formatCurrency(summary.totalElocalApi)}</strong></td>
                <td><strong>{formatCurrency(summary.totalRingba)}</strong></td>
                <td className={summary.totalAdjustments < 0 ? 'negative' : 'positive'}>
                  <strong>{formatCurrency(summary.totalAdjustments)}</strong>
                </td>
                <td className={summary.totalAdjustmentStatic < 0 ? 'negative' : 'positive'}>
                  <strong>{(summary.totalAdjustmentStatic * 100).toFixed(2)}%</strong>
                </td>
                <td className={summary.totalAdjustmentApi < 0 ? 'negative' : 'positive'}>
                  <strong>{(summary.totalAdjustmentApi * 100).toFixed(2)}%</strong>
                </td>
                <td className={summary.adjustmentPercentage < 0 ? 'negative' : 'positive'}>
                  <strong>{summary.adjustmentPercentage.toFixed(2)}%</strong>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
};

export default ChargebackTracker;

