import type { ReactNode } from 'react';
import './ForecastPanels.css';

export function ChartInfo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="chart-info">
      <summary aria-label={label}><span aria-hidden="true">ⓘ</span></summary>
      <div className="chart-info-content">{children}</div>
    </details>
  );
}
