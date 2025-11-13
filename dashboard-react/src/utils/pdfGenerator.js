import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export const generateChargebackPDF = (chargebackData) => {
  if (!chargebackData || !chargebackData.rows || chargebackData.rows.length === 0) {
    throw new Error('No chargeback data available');
  }

  const { rows, summary, dateRange } = chargebackData;
  const doc = new jsPDF('landscape'); // Landscape orientation for wide table

  // Title
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text('Chargeback Tracking Report', 14, 15);

  // Date range
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  if (dateRange) {
    doc.text(`Date Range: ${dateRange.startDate} to ${dateRange.endDate}`, 14, 22);
  }
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 27);

  // Summary section
  if (summary) {
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Summary', 14, 37);
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    let yPos = 44;
    
    doc.text(`Total Ringba Revenue: $${summary.totalRingba.toFixed(2)}`, 14, yPos);
    yPos += 6;
    doc.text(`Total Elocal Revenue: $${summary.totalElocal.toFixed(2)}`, 14, yPos);
    yPos += 6;
    doc.text(`Total Adjustments: $${summary.totalAdjustments.toFixed(2)}`, 14, yPos);
    yPos += 6;
    doc.text(`Adjustment Percentage: ${summary.adjustmentPercentage.toFixed(2)}%`, 14, yPos);
    yPos += 6;
    doc.text(`Adjustment (Static): ${(summary.totalAdjustmentStatic * 100).toFixed(2)}%`, 14, yPos);
    yPos += 6;
    doc.text(`Adjustment (API): ${(summary.totalAdjustmentApi * 100).toFixed(2)}%`, 14, yPos);
    yPos += 10;
  }

  // Table data
  const tableData = rows.map((row) => {
    const ringbaStatic = parseFloat(row.ringba_static || 0);
    const ringbaApi = parseFloat(row.ringba_api || 0);
    const elocalStatic = parseFloat(row.elocal_static || 0);
    const elocalApi = parseFloat(row.elocal_api || 0);
    
    const ringbaTotal = ringbaStatic + ringbaApi;
    const elocalTotal = elocalStatic + elocalApi;
    const total = ringbaTotal;
    const adjustments = ringbaTotal - elocalTotal;
    const adjustmentStatic = (ringbaStatic - elocalStatic) / 100;
    const adjustmentApi = (ringbaApi - elocalApi) / 100;
    const adjustmentPercentage = ringbaTotal !== 0 
      ? (adjustments / ringbaTotal) * 100 
      : 0;

    // Format date
    const date = new Date(row.date);
    const formattedDate = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    return [
      formattedDate,
      `$${ringbaStatic.toFixed(2)}`,
      `$${ringbaApi.toFixed(2)}`,
      `$${elocalStatic.toFixed(2)}`,
      `$${elocalApi.toFixed(2)}`,
      `$${total.toFixed(2)}`,
      `$${adjustments.toFixed(2)}`,
      `${(adjustmentStatic * 100).toFixed(2)}%`,
      `${(adjustmentApi * 100).toFixed(2)}%`,
      `${adjustmentPercentage.toFixed(2)}%`
    ];
  });

  // Add summary row
  if (summary) {
    tableData.push([
      'TOTAL',
      `$${summary.totalRingbaStatic.toFixed(2)}`,
      `$${summary.totalRingbaApi.toFixed(2)}`,
      `$${summary.totalElocalStatic.toFixed(2)}`,
      `$${summary.totalElocalApi.toFixed(2)}`,
      `$${summary.totalRingba.toFixed(2)}`,
      `$${summary.totalAdjustments.toFixed(2)}`,
      `${(summary.totalAdjustmentStatic * 100).toFixed(2)}%`,
      `${(summary.totalAdjustmentApi * 100).toFixed(2)}%`,
      `${summary.adjustmentPercentage.toFixed(2)}%`
    ]);
  }

  // Generate table
  autoTable(doc, {
    startY: summary ? 70 : 35,
    head: [[
      'Date',
      'Ringba Static',
      'Ringba API',
      'Elocal Static',
      'Elocal API',
      'Total',
      'Adjustments',
      'Adjustment (Static)',
      'Adjustment (API)',
      'Adjustment %'
    ]],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: [37, 99, 235], // Primary blue color
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9
    },
    bodyStyles: {
      fontSize: 8
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252] // Light gray
    },
    styles: {
      cellPadding: 3,
      overflow: 'linebreak',
      cellWidth: 'wrap'
    },
    columnStyles: {
      0: { cellWidth: 50 }, // Date
      1: { cellWidth: 50, halign: 'right' }, // Ringba Static
      2: { cellWidth: 50, halign: 'right' }, // Ringba API
      3: { cellWidth: 50, halign: 'right' }, // Elocal Static
      4: { cellWidth: 50, halign: 'right' }, // Elocal API
      5: { cellWidth: 50, halign: 'right' }, // Total
      6: { cellWidth: 50, halign: 'right' }, // Adjustments
      7: { cellWidth: 50, halign: 'right' }, // Adjustment (Static)
      8: { cellWidth: 50, halign: 'right' }, // Adjustment (API)
      9: { cellWidth: 50, halign: 'right' }  // Adjustment %
    },
    didParseCell: (data) => {
      // Style the summary row
      if (data.row.index === tableData.length - 1 && summary) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249]; // Light blue-gray
      }
      
      // Color code adjustments column (column index 6)
      if (data.column.index === 6 && data.row.index < tableData.length - 1) {
        const value = parseFloat(data.cell.text[0].replace('$', ''));
        if (value < 0) {
          data.cell.styles.textColor = [239, 68, 68]; // Red for negative
        } else if (value > 0) {
          data.cell.styles.textColor = [16, 185, 129]; // Green for positive
        }
      }
    }
  });

  // Generate filename with date range
  const filename = `chargeback-report-${dateRange?.startDate || 'all'}-to-${dateRange?.endDate || 'all'}.pdf`;
  
  // Save PDF
  doc.save(filename);
};

