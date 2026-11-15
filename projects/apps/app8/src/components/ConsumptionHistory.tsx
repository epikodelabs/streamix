import React from 'react';
import type { QueueItem } from '../types';
import { Check, Trash2 } from 'lucide-react';

interface ConsumptionHistoryProps {
  history: QueueItem[];
  onClearHistory: () => void;
}

export const ConsumptionHistory: React.FC<ConsumptionHistoryProps> = ({ history, onClearHistory }) => (
  <section className="focus-history" aria-label="FIFO delivery history">
    <div className="focus-history-heading">
      <h3>Consumption history <small>({history.length})</small></h3>
      <button onClick={onClearHistory} disabled={history.length === 0} type="button"><Trash2 size={14} /> Clear</button>
    </div>
    {history.length === 0 ? (
      <div className="focus-history-empty">No values consumed yet. Values appear here when delivery completes.</div>
    ) : (
      <div className="focus-history-scroll">
        <table>
          <thead><tr><th>Order</th><th>Value</th><th>Buffer dwell</th><th>Status</th></tr></thead>
          <tbody>{history.slice().reverse().map((item, index) => (
            <tr key={item.id}>
              <td>{index + 1}</td>
              <td><span className="focus-history-token" style={{ backgroundColor: item.color }}>{item.value}</span></td>
              <td>{((item.dwellTimeMs ?? 0) / 1000).toFixed(2)} s</td>
              <td><span className="focus-history-ok"><Check size={13} /> Delivered</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    )}
  </section>
);
