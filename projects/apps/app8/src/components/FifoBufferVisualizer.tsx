import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, ChevronDown, Lock, Pause, Play, RotateCcw, Zap } from 'lucide-react';
import type { QueueItem, ProducerStatus, ConsumerStatus, PushMode, PushOverflow } from '../types';

interface FifoBufferVisualizerProps {
  mode: PushMode;
  overflow: PushOverflow;
  capacity: number;
  items: QueueItem[];
  blockedItems: QueueItem[];
  stagedProducerToken: QueueItem;
  recentlyConsumedItem: QueueItem | null;
  inTransitInToken: QueueItem | null;
  inTransitOutToken: QueueItem | null;
  isEmitting: boolean;
  isBursting?: boolean;
  producerStatus: ProducerStatus;
  consumerStatus: ConsumerStatus;
  isFull: boolean;
  isEmpty: boolean;
  pendingPromisesCount: number;
  sessionState: {
    isStopped: boolean;
    isFinishing: boolean;
    isCompleted: boolean;
    hasError: boolean;
    errorMessage?: string;
  };
  subscriberValue: QueueItem | null;
  subscriberCount: number;
  onManualProduce: () => void;
  onManualBurst: () => void;
  onManualConsume: () => void;
  onSinkComplete: () => void;
  onSinkError: () => void;
  onRestartSession: () => void;
  isAutoPlay: boolean;
  onToggleAutoPlay: () => void;
  onStep: () => void;
  onReset: () => void;
}

const ENTRY_MS = 0.48;

/** One continuous vector arrow, scaled to fit the conveyor without gaps. */
const FlowArrow: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <svg
    className={compact ? 'focus-flow-arrow is-compact' : 'focus-flow-arrow'}
    viewBox="0 0 120 24"
    preserveAspectRatio="none"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M 3 12 H 111 M 102 4 L 111 12 L 102 20"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  </svg>
);

export const FifoBufferVisualizer: React.FC<FifoBufferVisualizerProps> = ({
  mode,
  overflow,
  capacity,
  items,
  blockedItems,
  stagedProducerToken,
  recentlyConsumedItem,
  inTransitInToken,
  inTransitOutToken,
  isEmitting,
  isBursting = false,
  producerStatus,
  consumerStatus,
  isEmpty,
  sessionState,
  onManualProduce,
  onManualBurst,
  onManualConsume,
  onSinkComplete,
  onSinkError,
  onRestartSession,
  isAutoPlay,
  onToggleAutoPlay,
  onStep,
  onReset,
}) => {
  const isDone = sessionState.isCompleted || sessionState.hasError;
  const waiting = blockedItems.slice(0, 3).reverse();
  const policyDescription = mode === 'analog'
    ? 'When full, each push replaces the newest queued value with the latest value.'
    : overflow === 'error'
      ? 'When full, the next push fails the source and clears the queue. This scenario intentionally ends in an error.'
      : overflow === 'drop-newest'
        ? 'When full, incoming values are discarded. Queued values stay in order; the Dropped count increases.'
        : overflow === 'drop-oldest'
          ? 'When full, each push removes the oldest queued value to make room.'
          : 'When full, the producer waits until a pull frees a slot.';

  return (
    <div className="focus-stage" aria-label="Live first-in first-out queue visualizer">
      <div className="focus-stage-heading">
        <div className="focus-stage-name">
          <Activity size={15} aria-hidden="true" />
          <span>Live queue</span>
        </div>
        <div className="focus-stage-properties">
          <span>{mode}</span><span aria-hidden="true">·</span>
          <span>{overflow}</span><span aria-hidden="true">·</span>
          <span>{items.length}/{capacity} slots</span>
        </div>
      </div>

      <p className="focus-policy-description">{policyDescription}</p>

      <div className="focus-pipeline-scroll">
        <div className="focus-pipeline">
          <div className="focus-station" aria-label="Producer">
            <span className="focus-node-label">Producer</span>
            <div className="focus-value" style={{ '--token-color': stagedProducerToken.color } as React.CSSProperties}>
              {stagedProducerToken.value}
            </div>
            <span className="focus-node-caption">
              {sessionState.hasError ? 'Failed' : sessionState.isFinishing || sessionState.isCompleted ? 'Closed' : isEmitting ? 'Pushing' : producerStatus === 'blocked' ? 'Backpressure' : 'Ready'}
            </span>
          </div>

          <div className="focus-conveyor" aria-label="Incoming transfer">
            <FlowArrow />
            <AnimatePresence>
              {inTransitInToken && (
                <motion.div
                  key={`in-${inTransitInToken.id}`}
                  className="focus-moving-token"
                  initial={{ x: -28, opacity: 1 }}
                  animate={{ x: 28, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: ENTRY_MS, ease: 'linear' }}
                  style={{ '--token-color': inTransitInToken.color } as React.CSSProperties}
                >
                  {inTransitInToken.value}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="focus-buffer" aria-label={`FIFO buffer, ${items.length} of ${capacity} slots occupied`}>
            <div className="focus-buffer-label">
              <strong>FIFO buffer</strong>
              <span>{items.length} / {capacity}</span>
            </div>
            <div className="focus-buffer-slots" style={{ gridTemplateColumns: `repeat(${capacity}, minmax(0, 1fr))` }}>
              {Array.from({ length: capacity }, (_, leftIndex) => {
                const queueIndex = capacity - leftIndex - 1;
                const item = queueIndex < items.length ? items[queueIndex] : null;
                return (
                  <div key={`slot-${leftIndex}`} className="focus-slot-wrap">
                    <span className="focus-slot-index" aria-hidden="true">{queueIndex}</span>
                    {item ? (
                      /* Shared layout id carries the tile between slots so the queue visibly shifts. */
                      <motion.div
                        key={item.id}
                        layoutId={`buffer-token-${item.id}`}
                        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                        className={`focus-slot is-occupied${queueIndex === 0 ? ' is-head' : ''}`}
                        style={{ '--token-color': item.color } as React.CSSProperties}
                      >
                        {item.value}
                      </motion.div>
                    ) : (
                      <div className="focus-slot">
                        <span aria-hidden="true">·</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="focus-buffer-axis"><span>← tail</span><span>head →</span></div>
          </div>

          <div className="focus-conveyor" aria-label="Outgoing transfer">
            <FlowArrow />
            <AnimatePresence>
              {inTransitOutToken && (
                <motion.div
                  key={`out-${inTransitOutToken.id}`}
                  className="focus-moving-token"
                  initial={{ x: -28, opacity: 1 }}
                  animate={{ x: 28, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: ENTRY_MS, ease: 'linear' }}
                  style={{ '--token-color': inTransitOutToken.color } as React.CSSProperties}
                >
                  {inTransitOutToken.value}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="focus-station" aria-label="Consumer">
            <span className="focus-node-label">Consumer</span>
            <div
              className={`focus-value${recentlyConsumedItem ? '' : ' is-empty'}`}
              style={recentlyConsumedItem ? ({ '--token-color': recentlyConsumedItem.color } as React.CSSProperties) : undefined}
            >
              {recentlyConsumedItem ? recentlyConsumedItem.value : '—'}
            </div>
            <span className="focus-node-caption">
              {isDone ? (sessionState.hasError ? 'Stopped' : 'Done') : consumerStatus === 'starved' && isEmpty ? 'Waiting' : recentlyConsumedItem ? 'Received' : 'Ready'}
            </span>
          </div>
        </div>
      </div>

      {blockedItems.length > 0 ? (
        <div className="focus-backlog" role="status" aria-live="polite">
          <span className="focus-backlog-title"><Lock size={13} /> Blocked <strong>{blockedItems.length}</strong></span>
          <span className="focus-backlog-values" aria-label="First three blocked items, oldest closest to buffer">
            {blockedItems.length > 3 && <span className="focus-backlog-more">+{blockedItems.length - 3}</span>}
            {waiting.map(item => (
              <span
                className="focus-backlog-token"
                key={item.id}
                style={{ '--token-color': item.color } as React.CSSProperties}
              >{item.value}</span>
            ))}
            <FlowArrow compact />
          </span>
        </div>
      ) : (
        <div className="focus-backlog-empty">No blocked values</div>
      )}

      <div className="focus-actions">
        <div className="focus-actions-primary">
          <button className="focus-button focus-button-primary" onClick={onToggleAutoPlay} disabled={isDone}>
            {isAutoPlay ? <Pause size={14} /> : <Play size={14} />}
            {isAutoPlay ? 'Pause' : 'Run'}
          </button>
          <button className="focus-button" onClick={onManualProduce} disabled={sessionState.isFinishing || isDone}>
            Push one
          </button>
          <button className="focus-button" onClick={onManualConsume} disabled={isEmpty || sessionState.hasError}>
            Pull one
          </button>
          <button className="focus-button" onClick={onManualBurst} disabled={isBursting || sessionState.isFinishing || isDone}>
            <Zap size={13} /> {isBursting ? 'Bursting' : 'Burst 3'}
          </button>
        </div>
        <details className="focus-actions-more">
          <summary className="focus-button focus-button-more">More <ChevronDown size={13} /></summary>
          <div className="focus-actions-menu">
            <button onClick={onStep} disabled={isAutoPlay || isDone}>Step once</button>
            <button onClick={onSinkComplete} disabled={sessionState.isFinishing || isDone}>Complete source</button>
            <button onClick={onSinkError} disabled={isDone} className="focus-danger">Simulate error</button>
            <button onClick={isDone ? onRestartSession : onReset}><RotateCcw size={13} /> {isDone ? 'Restart session' : 'Reset'}</button>
          </div>
        </details>
      </div>

      {sessionState.hasError && (
        <p className="focus-error-notice" role="alert">{sessionState.errorMessage || 'Source error'}</p>
      )}
    </div>
  );
};
