import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ListOrdered, Settings2 } from 'lucide-react';
import type { QueueItem, ScenarioPreset, ProducerStatus, ConsumerStatus, PushMode, PushOverflow, SimulationStats } from './types';
import { TopBar } from './components/TopBar';
import { FifoBufferVisualizer } from './components/FifoBufferVisualizer';
import { SimulationControls } from './components/SimulationControls';
import { MetricsPanel } from './components/MetricsPanel';
import { ConsumptionHistory } from './components/ConsumptionHistory';
import { EducationalGuideModal } from './components/EducationalGuideModal';
import { sound } from './utils/audio';

const TRANSIT_MS = 480;
const TOKEN_COLORS = ['#6750a4', '#277bb5', '#0b937d', '#699f51', '#c58c40', '#b96948', '#ad5d83', '#7975c5'];
const initialStats = (): SimulationStats => ({
  totalProduced: 0, totalDelivered: 0, totalBlockedEvents: 0,
  totalDropped: 0, peakOccupancy: 0, averageDwellTimeMs: 0, pendingPromises: 0,
});

function makeToken(seq: number): QueueItem {
  return { id: seq, value: seq, producedAt: Date.now(),
    color: TOKEN_COLORS[(seq - 1) % TOKEN_COLORS.length], status: 'queued' };
}

/**
 * A push waiting for buffer capacity. Its resolver fires at admission, which
 * is what the source awaits for backpressure (`fromPush` resolves on
 * acceptance, not on delivery).
 */
interface PendingPush {
  item: QueueItem;
  resolve: () => void;
}

/**
 * This application is a visual simulation of push-to-pull flow control, not a
 * binding to the Streamix npm runtime. The buffer, blocked queue and inlet
 * reservations have distinct ownership; visual entry is committed only on
 * arrival. A push is admitted — and its promise resolved — when it claims
 * buffer capacity; the inlet transfer is presentation. The automatic source
 * awaits every push, while manual and burst controls deliberately do not.
 */
export default function App() {
  const [mode, setMode] = useState<PushMode>('discrete');
  const [overflow, setOverflow] = useState<PushOverflow>('block');
  const [capacity, setCapacity] = useState(8);
  const [producerRate, setProducerRate] = useState(1.0);
  const [consumerRate, setConsumerRate] = useState(3.0);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [isAutoPlay, setIsAutoPlay] = useState(true);
  const [activeScenario, setActiveScenario] = useState<ScenarioPreset>('backpressure-block');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [blockedItems, setBlockedItems] = useState<QueueItem[]>([]);
  const [reservedCount, setReservedCount] = useState(0);
  const [stagedProducerToken, setStagedProducerToken] = useState(() => makeToken(1));
  const [inTransitInToken, setInTransitInToken] = useState<QueueItem | null>(null);
  const [inTransitOutToken, setInTransitOutToken] = useState<QueueItem | null>(null);
  const [recentlyConsumedItem, setRecentlyConsumedItem] = useState<QueueItem | null>(null);
  const [isEmitting, setIsEmitting] = useState(false);
  const [isBursting, setIsBursting] = useState(false);
  const [burstRemaining, setBurstRemaining] = useState(0);
  const [subscriberValue, setSubscriberValue] = useState<QueueItem | null>(null);
  const [producerStatus, setProducerStatus] = useState<ProducerStatus>('idle');
  const [consumerStatus, setConsumerStatus] = useState<ConsumerStatus>('idle');
  const [isFinishing, setIsFinishing] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [stats, setStats] = useState<SimulationStats>(initialStats);
  const [consumptionHistory, setConsumptionHistory] = useState<QueueItem[]>([]);

  // Refs are authoritative inside independent timer callbacks; React state is
  // published synchronously, never mutated from a state-updater callback.
  const seqRef = useRef(1);
  const queueRef = useRef<QueueItem[]>([]);
  const blockedRef = useRef<PendingPush[]>([]);
  const reservedRef = useRef<QueueItem[]>([]);
  const incomingRef = useRef(false);
  const outgoingRef = useRef(false);
  const finishingRef = useRef(false);
  const completedRef = useRef(false);
  const errorRef = useRef(false);
  const epochRef = useRef(0);
  const incomingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outgoingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchInletRef = useRef<() => void>(() => {});
  const fillVacanciesRef = useRef<() => void>(() => {});
  const checkCompletionRef = useRef<() => void>(() => {});

  const commitItems = useCallback((next: QueueItem[]) => {
    queueRef.current = next;
    setItems(next);
    setStats(prev => ({ ...prev, peakOccupancy: Math.max(prev.peakOccupancy, next.length) }));
  }, []);
  const commitBlocked = useCallback((next: PendingPush[]) => {
    blockedRef.current = next;
    setBlockedItems(next.map(record => record.item));
  }, []);
  /** Releases every push still waiting for capacity (session stop/reset). */
  const settlePendingPushes = useCallback(() => {
    for (const record of blockedRef.current) record.resolve();
  }, []);
  const publishReservations = useCallback(() => setReservedCount(reservedRef.current.length), []);

  useEffect(() => { sound.enabled = soundEnabled; }, [soundEnabled]);

  const checkCompletion = useCallback(() => {
    if (!finishingRef.current || completedRef.current || errorRef.current) return;
    if (queueRef.current.length !== 0 || blockedRef.current.length !== 0 ||
        reservedRef.current.length !== 0 || incomingRef.current || outgoingRef.current) return;
    completedRef.current = true;
    setIsCompleted(true);
    setConsumerStatus('completed');
    setProducerStatus('completed');
  }, []);
  checkCompletionRef.current = checkCompletion;

  // At most one token is visually in transit, even when many buffer slots have
  // already been reserved. A reservation is not a visible buffered item.
  const launchInlet = useCallback(() => {
    if (incomingRef.current || completedRef.current || errorRef.current) return;
    const token = reservedRef.current[0];
    if (!token) { checkCompletionRef.current(); return; }
    incomingRef.current = true;
    setIsEmitting(true);
    setInTransitInToken(token);
    setProducerStatus('producing');
    const epoch = epochRef.current;
    incomingTimerRef.current = setTimeout(() => {
      incomingTimerRef.current = null;
      if (epoch !== epochRef.current || errorRef.current) return;
      incomingRef.current = false;
      setIsEmitting(false);
      setInTransitInToken(null);
      // The visual slot becomes populated only after the transfer animation.
      reservedRef.current.shift();
      publishReservations();
      if (queueRef.current.length >= capacity) {
        // Defensive: never silently drop a reserved item. Its push promise
        // was already settled at admission, so there is nothing left to await.
        commitBlocked([{ item: { ...token, status: 'blocked' }, resolve: () => {} }, ...blockedRef.current]);
      } else {
        commitItems([...queueRef.current, { ...token, enteredBufferAt: Date.now(), status: 'queued' }]);
        sound.playEnqueue();
      }
      fillVacanciesRef.current();
      launchInletRef.current();
      setProducerStatus(blockedRef.current.length ? 'blocked' : finishingRef.current ? 'completed' : 'idle');
      checkCompletionRef.current();
    }, TRANSIT_MS);
  }, [capacity, commitBlocked, commitItems, publishReservations]);
  launchInletRef.current = launchInlet;

  const fillVacancies = useCallback(() => {
    if (errorRef.current || completedRef.current || mode !== 'discrete' || overflow !== 'block') return;
    const free = capacity - queueRef.current.length - reservedRef.current.length;
    if (free <= 0 || blockedRef.current.length === 0) return;
    const admitted = blockedRef.current.slice(0, free);
    reservedRef.current.push(...admitted.map(record => record.item));
    publishReservations();
    commitBlocked(blockedRef.current.slice(admitted.length));
    // Admission into buffer capacity ends producer backpressure. The inlet
    // animation is presentation and does not delay the source.
    for (const record of admitted) record.resolve();
    if (blockedRef.current.length) setProducerStatus('blocked');
    launchInletRef.current();
  }, [capacity, mode, overflow, commitBlocked, publishReservations]);
  fillVacanciesRef.current = fillVacancies;

  const abortSimulation = useCallback((reason: string) => {
    epochRef.current++;
    if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
    if (outgoingTimerRef.current) clearTimeout(outgoingTimerRef.current);
    incomingTimerRef.current = null;
    outgoingTimerRef.current = null;
    incomingRef.current = false;
    outgoingRef.current = false;
    settlePendingPushes();
    reservedRef.current = [];
    publishReservations();
    commitItems([]);
    commitBlocked([]);
    setInTransitInToken(null);
    setInTransitOutToken(null);
    setIsEmitting(false);
    setBurstRemaining(0);
    setIsBursting(false);
    finishingRef.current = true;
    completedRef.current = true;
    errorRef.current = true;
    setIsFinishing(true);
    setIsCompleted(true);
    setHasError(true);
    setErrorMessage(reason);
    setProducerStatus('error');
    setConsumerStatus('completed');
    sound.playBlocked();
  }, [commitItems, commitBlocked, publishReservations, settlePendingPushes]);

  const handleProduce = useCallback((): Promise<boolean> => {
    if (finishingRef.current || completedRef.current || errorRef.current) return Promise.resolve(false);
    const token = makeToken(seqRef.current++);
    setStagedProducerToken(makeToken(seqRef.current));
    const queued = queueRef.current.length;
    const reserved = reservedRef.current.length;
    const free = capacity - queued - reserved;

    // Discrete/block: reserve buffer space FIRST. Only excess goes to blocked.
    if (mode === 'discrete' && overflow === 'block') {
      if (free > 0 && blockedRef.current.length === 0) {
        reservedRef.current.push(token);
        publishReservations();
        launchInletRef.current();
        sound.playProduce();
        setStats(prev => ({ ...prev, totalProduced: prev.totalProduced + 1 }));
        // Admission claims buffer capacity and ends backpressure immediately.
        return Promise.resolve(true);
      }
      // The push stays pending until fillVacancies admits it. An awaiting
      // source stalls here instead of accumulating ignored pushes.
      return new Promise<boolean>(resolve => {
        commitBlocked([...blockedRef.current, {
          item: { ...token, status: 'blocked' },
          resolve: () => resolve(true),
        }]);
        setStats(prev => ({ ...prev,
          totalProduced: prev.totalProduced + 1,
          totalBlockedEvents: prev.totalBlockedEvents + 1 }));
        setProducerStatus('blocked');
        sound.playBlocked();
      });
    }

    if (free <= 0) {
      if (overflow === 'error') {
        abortSimulation(`Buffer capacity exceeded (${capacity})`);
        return Promise.resolve(false);
      }
      if (overflow === 'drop-newest') {
        setStats(prev => ({ ...prev, totalProduced: prev.totalProduced + 1, totalDropped: prev.totalDropped + 1 }));
        sound.playBlocked();
        return Promise.resolve(true);
      }
      // Drop the oldest visible value or, if nothing is visible, replace the
      // newest reservation that has not started its animation.
      if (queueRef.current.length > 0) {
        commitItems(queueRef.current.slice(1));
        setStats(prev => ({ ...prev, totalDropped: prev.totalDropped + 1 }));
      } else if (reservedRef.current.length > 1) {
        reservedRef.current.pop();
        publishReservations();
        setStats(prev => ({ ...prev, totalDropped: prev.totalDropped + 1 }));
      }
      // Otherwise the only reserved item is already in transit; hold the new
      // value as a single deferred latest reservation without dropping anything.
    }
    // If the buffer was freed by dropping an item, the new value still travels
    // along the inlet before it becomes visible in the buffer.
    reservedRef.current.push(token);
    publishReservations();
    launchInletRef.current();
    setStats(prev => ({ ...prev, totalProduced: prev.totalProduced + 1 }));
    sound.playProduce();
    return Promise.resolve(true);
  }, [abortSimulation, capacity, commitBlocked, commitItems, mode, overflow, publishReservations]);

  const handleConsume = useCallback((): boolean => {
    if (errorRef.current || outgoingRef.current || queueRef.current.length === 0) {
      if (!errorRef.current && queueRef.current.length === 0 && !finishingRef.current) setConsumerStatus('starved');
      return false;
    }
    const token = queueRef.current[0];
    outgoingRef.current = true;
    const departed: QueueItem = { ...token, status: 'delivered', consumedAt: Date.now(),
      dwellTimeMs: token.enteredBufferAt ? Date.now() - token.enteredBufferAt : 0 };
    commitItems(queueRef.current.slice(1));
    fillVacanciesRef.current();
    setInTransitOutToken(departed);
    setConsumerStatus('consuming');
    sound.playConsume();
    const epoch = epochRef.current;
    outgoingTimerRef.current = setTimeout(() => {
      outgoingTimerRef.current = null;
      if (epoch !== epochRef.current || errorRef.current) return;
      outgoingRef.current = false;
      setInTransitOutToken(null);
      setRecentlyConsumedItem(departed);
      setSubscriberValue(departed);
      setConsumptionHistory(prev => [departed, ...prev]);
      setStats(prev => {
        const count = prev.totalDelivered + 1;
        return { ...prev, totalDelivered: count,
          averageDwellTimeMs: Math.round((prev.averageDwellTimeMs * prev.totalDelivered + (departed.dwellTimeMs || 0)) / count) };
      });
      setConsumerStatus('idle');
      checkCompletionRef.current();
    }, TRANSIT_MS);
    return true;
  }, [commitItems]);

  const handleComplete = useCallback(() => {
    if (finishingRef.current || completedRef.current || errorRef.current) return;
    finishingRef.current = true;
    setIsFinishing(true);
    setProducerStatus('completed');
    setBurstRemaining(0);
    checkCompletionRef.current();
  }, []);

  const handleReset = useCallback(() => {
    epochRef.current++;
    if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
    if (outgoingTimerRef.current) clearTimeout(outgoingTimerRef.current);
    incomingTimerRef.current = null;
    outgoingTimerRef.current = null;
    incomingRef.current = false;
    outgoingRef.current = false;
    finishingRef.current = false;
    completedRef.current = false;
    errorRef.current = false;
    settlePendingPushes();
    reservedRef.current = [];
    publishReservations();
    seqRef.current = 1;
    commitItems([]);
    commitBlocked([]);
    setStagedProducerToken(makeToken(1));
    setInTransitInToken(null);
    setInTransitOutToken(null);
    setRecentlyConsumedItem(null);
    setSubscriberValue(null);
    setIsEmitting(false);
    setIsBursting(false);
    setBurstRemaining(0);
    setIsFinishing(false);
    setIsCompleted(false);
    setHasError(false);
    setErrorMessage(undefined);
    setProducerStatus('idle');
    setConsumerStatus('idle');
    setStats(initialStats());
    setConsumptionHistory([]);
  }, [commitBlocked, commitItems, publishReservations, settlePendingPushes]);

  const handleScenario = useCallback((preset: ScenarioPreset) => {
    handleReset();
    setActiveScenario(preset);
    switch (preset) {
      case 'backpressure-block': setMode('discrete'); setOverflow('block'); setCapacity(4); setProducerRate(1); setConsumerRate(3); setIsAutoPlay(true); break;
      case 'analog-coalescing': setMode('analog'); setOverflow('drop-oldest'); setCapacity(1); setProducerRate(.8); setConsumerRate(2.4); setIsAutoPlay(true); break;
      case 'drop-oldest': setMode('discrete'); setOverflow('drop-oldest'); setCapacity(4); setProducerRate(1); setConsumerRate(2.8); setIsAutoPlay(true); break;
      case 'drop-newest': setMode('discrete'); setOverflow('drop-newest'); setCapacity(4); setProducerRate(1); setConsumerRate(2.8); setIsAutoPlay(true); break;
      case 'overflow-error': setMode('discrete'); setOverflow('error'); setCapacity(4); setProducerRate(1); setConsumerRate(4); setIsAutoPlay(true); break;
      case 'balanced': setMode('discrete'); setOverflow('block'); setCapacity(6); setProducerRate(1.8); setConsumerRate(1.8); setIsAutoPlay(true); break;
      case 'burst': setMode('discrete'); setOverflow('block'); setCapacity(6); setProducerRate(.6); setConsumerRate(2.2); setIsAutoPlay(true); break;
      case 'manual': setIsAutoPlay(false); break;
    }
  }, [handleReset]);

  useEffect(() => {
    if (!isAutoPlay || isFinishing || isCompleted || hasError) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const intervalMs = Math.max(300, producerRate * 1000 / speedMultiplier);

    // A sequential source: it does not start a new emission until the previous
    // push is accepted. While the buffer is full the promise stays pending, so
    // the generator is genuinely stalled. A fire-and-forget timer source would
    // keep firing here and simply grow the blocked backlog instead.
    const tick = async () => {
      if (cancelled) return;
      const startedAt = Date.now();
      const accepted = await handleProduce();
      if (cancelled || !accepted) return;
      const wait = Math.max(0, intervalMs - (Date.now() - startedAt));
      timer = setTimeout(() => { void tick(); }, wait);
    };

    timer = setTimeout(() => { void tick(); }, intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isAutoPlay, isFinishing, isCompleted, hasError, producerRate, speedMultiplier, handleProduce]);
  useEffect(() => {
    if (!isAutoPlay || isCompleted || hasError) return;
    const interval = setInterval(handleConsume, Math.max(300, consumerRate * 1000 / speedMultiplier));
    return () => clearInterval(interval);
  }, [isAutoPlay, isCompleted, hasError, consumerRate, speedMultiplier, handleConsume]);
  useEffect(() => {
    if (burstRemaining <= 0) { setIsBursting(false); return; }
    if (isFinishing || isCompleted || hasError) { setBurstRemaining(0); setIsBursting(false); return; }
    setIsBursting(true);
    const timer = setTimeout(() => {
      // Burst is the deliberate fire-and-forget case: the promise is ignored,
      // so pushes may pile up while the buffer is full.
      void handleProduce();
      setBurstRemaining(prev => Math.max(0, prev - 1));
    }, 160);
    return () => clearTimeout(timer);
  }, [burstRemaining, isFinishing, isCompleted, hasError, handleProduce]);

  const handleStep = () => {
    if (queueRef.current.length > 0) handleConsume();
    else void handleProduce();
  };
  // Only blocked pushes are unresolved: admission settles the promise.
  const pendingValues = blockedItems.length;
  const isFull = items.length + reservedCount >= capacity;
  const simulationStats = { ...stats, pendingPromises: pendingValues };

  return (
    <div className="focus-workbench">
      <TopBar onReset={handleReset} onOpenGuide={() => setIsGuideOpen(true)}
        soundEnabled={soundEnabled} onToggleSound={() => setSoundEnabled(prev => !prev)}
        activeSection="visualizer" onSelectSection={() => document.getElementById('visualizer')?.scrollIntoView({ behavior: 'smooth' })} />
      <main className="focus-main">
        <section className="focus-intro" aria-label="Session status">
          <div><h1>FIFO queue</h1><p>Push-to-pull flow control · FIFO buffer and backpressure</p></div>
          <div className={`focus-session-state${hasError ? ' is-error' : isCompleted ? ' is-done' : isFinishing ? ' is-draining' : ''}`}>
            {hasError ? 'Error' : isCompleted ? 'Completed' : isFinishing ? 'Draining' : isAutoPlay ? 'Running' : 'Paused'}
          </div>
        </section>
        <section id="visualizer" className="focus-live-section">
          <FifoBufferVisualizer mode={mode} overflow={overflow} capacity={capacity}
            items={items} blockedItems={blockedItems} stagedProducerToken={stagedProducerToken}
            recentlyConsumedItem={recentlyConsumedItem} inTransitInToken={inTransitInToken}
            inTransitOutToken={inTransitOutToken} isEmitting={isEmitting} isBursting={isBursting}
            producerStatus={producerStatus} consumerStatus={consumerStatus} isFull={isFull}
            isEmpty={items.length === 0} pendingPromisesCount={pendingValues}
            sessionState={{ isStopped: isCompleted || hasError, isFinishing, isCompleted, hasError, errorMessage }}
            subscriberValue={subscriberValue} subscriberCount={1}
            onManualProduce={handleProduce} onManualBurst={() => setBurstRemaining(prev => prev + 3)}
            onManualConsume={handleConsume} onSinkComplete={handleComplete}
            onSinkError={() => abortSimulation('Simulated source error')}
            onRestartSession={handleReset} isAutoPlay={isAutoPlay}
            onToggleAutoPlay={() => setIsAutoPlay(prev => !prev)} onStep={handleStep} onReset={handleReset} />
        </section>
        <section className="focus-secondary" aria-label="Additional tools">
          <details className="focus-panel" id="controls" open>
            <summary><Settings2 size={16} /><span>Configuration</span></summary>
            <div className="focus-panel-body">
              <SimulationControls isAutoPlay={isAutoPlay} onToggleAutoPlay={() => setIsAutoPlay(prev => !prev)}
                onStep={handleStep} onReset={handleReset} mode={mode}
                onChangeMode={newMode => { handleReset(); setMode(newMode); setOverflow(newMode === 'analog' ? 'drop-oldest' : 'block'); setCapacity(newMode === 'analog' ? 1 : 6); }}
                overflow={overflow} onChangeOverflow={newValue => { handleReset(); setOverflow(newValue); }}
                capacity={capacity} onChangeCapacity={newValue => { handleReset(); setCapacity(newValue); }}
                producerRate={producerRate} onChangeProducerRate={setProducerRate}
                consumerRate={consumerRate} onChangeConsumerRate={setConsumerRate}
                speedMultiplier={speedMultiplier} onChangeSpeedMultiplier={setSpeedMultiplier}
                activeScenario={activeScenario} onSelectScenario={handleScenario} />
            </div>
          </details>
          <details className="focus-panel" id="history" open>
            <summary><ListOrdered size={16} /><span>Activity &amp; metrics</span></summary>
            <div className="focus-panel-body">
              <MetricsPanel stats={simulationStats} currentOccupancy={items.length} capacity={capacity}
                isFull={isFull} mode={mode} overflow={overflow} />
              <ConsumptionHistory history={consumptionHistory} onClearHistory={() => setConsumptionHistory([])} />
            </div>
          </details>
        </section>
        <div className="focus-statusline" role="status">
          <Activity size={13} /><span>Buffer {items.length}/{capacity}</span>
          <span>Blocked {blockedItems.length}</span><span>Delivered {stats.totalDelivered}</span>
          <span className="focus-statusline-end">{isFinishing && !isCompleted ? 'Draining remaining values…' : 'Values delivered in FIFO order'}</span>
        </div>
      </main>
      <EducationalGuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </div>
  );
}
