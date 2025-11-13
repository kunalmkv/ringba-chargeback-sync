import React from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  PointElement,
  LineElement
} from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';
import { formatCurrency, formatDate } from '../utils/formatters';

// Register Chart.js components
ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  PointElement,
  LineElement
);

const ChargebackCharts = ({ chargebackData }) => {
  if (!chargebackData || !chargebackData.rows || chargebackData.rows.length === 0) {
    return null;
  }

  const { rows, summary } = chargebackData;

  // Chart 1: Revenue Breakdown (Ringba vs Elocal) - Pie Chart
  const revenueBreakdownData = {
    labels: ['Ringba Revenue', 'Elocal Revenue'],
    datasets: [
      {
        label: 'Revenue',
        data: [
          summary.totalRingba || 0,
          summary.totalElocal || 0
        ],
        backgroundColor: [
          'rgba(37, 99, 235, 0.8)',  // Blue for Ringba
          'rgba(16, 185, 129, 0.8)'  // Green for Elocal
        ],
        borderColor: [
          'rgba(37, 99, 235, 1)',
          'rgba(16, 185, 129, 1)'
        ],
        borderWidth: 2
      }
    ]
  };

  // Chart 2: Category Breakdown (Static vs API) - Pie Chart
  const categoryBreakdownData = {
    labels: ['Ringba Static', 'Ringba API', 'Elocal Static', 'Elocal API'],
    datasets: [
      {
        label: 'Revenue by Category',
        data: [
          summary.totalRingbaStatic || 0,
          summary.totalRingbaApi || 0,
          summary.totalElocalStatic || 0,
          summary.totalElocalApi || 0
        ],
        backgroundColor: [
          'rgba(37, 99, 235, 0.8)',   // Blue for Ringba Static
          'rgba(59, 130, 246, 0.8)',  // Light Blue for Ringba API
          'rgba(16, 185, 129, 0.8)',  // Green for Elocal Static
          'rgba(34, 197, 94, 0.8)'    // Light Green for Elocal API
        ],
        borderColor: [
          'rgba(37, 99, 235, 1)',
          'rgba(59, 130, 246, 1)',
          'rgba(16, 185, 129, 1)',
          'rgba(34, 197, 94, 1)'
        ],
        borderWidth: 2
      }
    ]
  };

  // Chart 3: Adjustments Over Time - Bar Chart
  const adjustmentsOverTimeData = {
    labels: rows.slice(0, 15).reverse().map(row => {
      const date = new Date(row.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }),
    datasets: [
      {
        label: 'Adjustments ($)',
        data: rows.slice(0, 15).reverse().map(row => {
          const ringbaTotal = parseFloat(row.ringba_static || 0) + parseFloat(row.ringba_api || 0);
          const elocalTotal = parseFloat(row.elocal_static || 0) + parseFloat(row.elocal_api || 0);
          return ringbaTotal - elocalTotal;
        }),
        backgroundColor: rows.slice(0, 15).reverse().map(row => {
          const ringbaTotal = parseFloat(row.ringba_static || 0) + parseFloat(row.ringba_api || 0);
          const elocalTotal = parseFloat(row.elocal_static || 0) + parseFloat(row.elocal_api || 0);
          const adjustment = ringbaTotal - elocalTotal;
          return adjustment >= 0 
            ? 'rgba(239, 68, 68, 0.8)'  // Red for losses (positive adjustments = we pay more)
            : 'rgba(16, 185, 129, 0.8)'; // Green for gains (negative adjustments = we pay less)
        }),
        borderColor: rows.slice(0, 15).reverse().map(row => {
          const ringbaTotal = parseFloat(row.ringba_static || 0) + parseFloat(row.ringba_api || 0);
          const elocalTotal = parseFloat(row.elocal_static || 0) + parseFloat(row.elocal_api || 0);
          const adjustment = ringbaTotal - elocalTotal;
          return adjustment >= 0 
            ? 'rgba(239, 68, 68, 1)'
            : 'rgba(16, 185, 129, 1)';
        }),
        borderWidth: 1
      }
    ]
  };

  // Chart 4: Daily Revenue Comparison (Ringba vs Elocal) - Bar Chart
  const dailyRevenueComparisonData = {
    labels: rows.slice(0, 15).reverse().map(row => {
      const date = new Date(row.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }),
    datasets: [
      {
        label: 'Ringba Revenue',
        data: rows.slice(0, 15).reverse().map(row => {
          return parseFloat(row.ringba_static || 0) + parseFloat(row.ringba_api || 0);
        }),
        backgroundColor: 'rgba(37, 99, 235, 0.8)',
        borderColor: 'rgba(37, 99, 235, 1)',
        borderWidth: 1
      },
      {
        label: 'Elocal Revenue',
        data: rows.slice(0, 15).reverse().map(row => {
          return parseFloat(row.elocal_static || 0) + parseFloat(row.elocal_api || 0);
        }),
        backgroundColor: 'rgba(16, 185, 129, 0.8)',
        borderColor: 'rgba(16, 185, 129, 1)',
        borderWidth: 1
      }
    ]
  };

  // Chart 5: Category Comparison (Static vs API) - Bar Chart
  const categoryComparisonData = {
    labels: ['Ringba', 'Elocal'],
    datasets: [
      {
        label: 'Static',
        data: [
          summary.totalRingbaStatic || 0,
          summary.totalElocalStatic || 0
        ],
        backgroundColor: 'rgba(37, 99, 235, 0.8)',
        borderColor: 'rgba(37, 99, 235, 1)',
        borderWidth: 1
      },
      {
        label: 'API',
        data: [
          summary.totalRingbaApi || 0,
          summary.totalElocalApi || 0
        ],
        backgroundColor: 'rgba(59, 130, 246, 0.8)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1
      }
    ]
  };

  // Chart 6: Losses vs Gains Breakdown - Pie Chart
  const totalLosses = rows.reduce((sum, row) => {
    const ringbaTotal = parseFloat(row.ringba_static || 0) + parseFloat(row.ringba_api || 0);
    const elocalTotal = parseFloat(row.elocal_static || 0) + parseFloat(row.elocal_api || 0);
    const adjustment = ringbaTotal - elocalTotal;
    return sum + (adjustment > 0 ? adjustment : 0);
  }, 0);

  const totalGains = rows.reduce((sum, row) => {
    const ringbaTotal = parseFloat(row.ringba_static || 0) + parseFloat(row.ringba_api || 0);
    const elocalTotal = parseFloat(row.elocal_static || 0) + parseFloat(row.elocal_api || 0);
    const adjustment = ringbaTotal - elocalTotal;
    return sum + (adjustment < 0 ? Math.abs(adjustment) : 0);
  }, 0);

  const lossesGainsData = {
    labels: ['Losses (Ringba > Elocal)', 'Gains (Ringba < Elocal)'],
    datasets: [
      {
        label: 'Amount',
        data: [totalLosses, totalGains],
        backgroundColor: [
          'rgba(239, 68, 68, 0.8)',  // Red for losses
          'rgba(16, 185, 129, 0.8)'  // Green for gains
        ],
        borderColor: [
          'rgba(239, 68, 68, 1)',
          'rgba(16, 185, 129, 1)'
        ],
        borderWidth: 2
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 15,
          font: {
            size: 12
          }
        }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            let label = context.label || '';
            if (label) {
              label += ': ';
            }
            label += formatCurrency(context.parsed.y || context.parsed);
            return label;
          }
        }
      }
    }
  };

  const pieChartOptions = {
    ...chartOptions,
    plugins: {
      ...chartOptions.plugins,
      tooltip: {
        callbacks: {
          label: function(context) {
            let label = context.label || '';
            if (label) {
              label += ': ';
            }
            const value = context.parsed || 0;
            label += formatCurrency(value);
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
            label += ` (${percentage}%)`;
            return label;
          }
        }
      }
    }
  };

  return (
    <div className="chargeback-charts">
      <div className="charts-grid">
        {/* Chart 1: Revenue Breakdown */}
        <div className="chart-container">
          <h3>Revenue Breakdown</h3>
          <div className="chart-wrapper">
            <Pie data={revenueBreakdownData} options={pieChartOptions} />
          </div>
        </div>

        {/* Chart 2: Category Breakdown */}
        <div className="chart-container">
          <h3>Category Breakdown</h3>
          <div className="chart-wrapper">
            <Pie data={categoryBreakdownData} options={pieChartOptions} />
          </div>
        </div>

        {/* Chart 3: Adjustments Over Time */}
        <div className="chart-container chart-wide">
          <h3>Adjustments Over Time (Last 15 Days)</h3>
          <div className="chart-wrapper">
            <Bar data={adjustmentsOverTimeData} options={chartOptions} />
          </div>
        </div>

        {/* Chart 4: Daily Revenue Comparison */}
        <div className="chart-container chart-wide">
          <h3>Daily Revenue Comparison (Last 15 Days)</h3>
          <div className="chart-wrapper">
            <Bar data={dailyRevenueComparisonData} options={chartOptions} />
          </div>
        </div>

        {/* Chart 5: Category Comparison */}
        <div className="chart-container">
          <h3>Category Comparison</h3>
          <div className="chart-wrapper">
            <Bar data={categoryComparisonData} options={chartOptions} />
          </div>
        </div>

        {/* Chart 6: Losses vs Gains */}
        <div className="chart-container">
          <h3>Losses vs Gains</h3>
          <div className="chart-wrapper">
            <Pie data={lossesGainsData} options={pieChartOptions} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChargebackCharts;

