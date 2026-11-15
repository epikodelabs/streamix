import React from 'react';
import type { SimulationStats, PushMode, PushOverflow } from '../types';

interface MetricsPanelProps {
  stats: SimulationStats;
  currentOccupancy: number;
  capacity: number;
  isFull: boolean;
  mode: PushMode;
  overflow: PushOverflow;
}

export const MetricsPanel: React.FC<MetricsPanelProps> = ({ stats, currentOccupancy, capacity, mode, overflow }) => (
  <section className="focus-telemetry" aria-label="Live queue metrics">
    <div><span>Buffered</span><strong>{currentOccupancy} / {capacity}</strong></div>
    <div><span>Pushed</span><strong>{stats.totalProduced}</strong></div>
    <div><span>Delivered</span><strong>{stats.totalDelivered}</strong></div>
    <div><span>Pending pushes</span><strong>{stats.pendingPromises}</strong></div>
    <div><span>Backpressure events</span><strong>{stats.totalBlockedEvents}</strong></div>
    <div><span>Dropped</span><strong>{stats.totalDropped}</strong></div>
    <div><span>Average dwell</span><strong>{(stats.averageDwellTimeMs / 1000).toFixed(2)} s</strong></div>
    <div><span>Policy</span><strong>{mode} / {overflow}</strong></div>
  </section>
);
