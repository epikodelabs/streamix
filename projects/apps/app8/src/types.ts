export type PushMode = 'discrete' | 'analog';
export type PushOverflow = 'block' | 'drop-oldest' | 'drop-newest' | 'error';

export interface QueueItem {
  id: number;
  value: number;
  color: string;
  producedAt: number;
  enteredBufferAt?: number;
  consumedAt?: number;
  dwellTimeMs?: number;
  status?: 'queued' | 'blocked' | 'delivered' | 'dropped';
  dropReason?: string;
  promiseResolved?: boolean;
}
export type ProducerStatus = 'idle' | 'producing' | 'blocked' | 'completed' | 'error';
export type ConsumerStatus = 'idle' | 'consuming' | 'starved' | 'completed';
export interface SimulationStats {
  totalProduced: number;
  totalDelivered: number;
  totalBlockedEvents: number;
  totalDropped: number;
  peakOccupancy: number;
  averageDwellTimeMs: number;
  pendingPromises: number;
}
export type ScenarioPreset =
  | 'balanced' | 'backpressure-block' | 'analog-coalescing'
  | 'drop-oldest' | 'drop-newest' | 'overflow-error' | 'burst' | 'manual';
