import React from 'react';
import type { ScenarioPreset, PushMode, PushOverflow } from '../types';

interface SimulationControlsProps {
  isAutoPlay: boolean;
  onToggleAutoPlay: () => void;
  onStep: () => void;
  onReset: () => void;
  mode: PushMode;
  onChangeMode: (mode: PushMode) => void;
  overflow: PushOverflow;
  onChangeOverflow: (overflow: PushOverflow) => void;
  capacity: number;
  onChangeCapacity: (capacity: number) => void;
  producerRate: number;
  onChangeProducerRate: (rate: number) => void;
  consumerRate: number;
  onChangeConsumerRate: (rate: number) => void;
  speedMultiplier: number;
  onChangeSpeedMultiplier: (speed: number) => void;
  activeScenario: ScenarioPreset;
  onSelectScenario: (scenario: ScenarioPreset) => void;
}

const scenarios: { value: ScenarioPreset; label: string }[] = [
  { value: 'backpressure-block', label: 'Backpressure' },
  { value: 'analog-coalescing', label: 'Analog coalescing' },
  { value: 'drop-oldest', label: 'Drop oldest' },
  { value: 'drop-newest', label: 'Drop newest' },
  { value: 'overflow-error', label: 'Overflow error' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'burst', label: 'Burst traffic' },
  { value: 'manual', label: 'Manual' },
];

export const SimulationControls: React.FC<SimulationControlsProps> = ({
  mode, onChangeMode,
  overflow, onChangeOverflow,
  capacity, onChangeCapacity,
  producerRate, onChangeProducerRate,
  consumerRate, onChangeConsumerRate,
  speedMultiplier, onChangeSpeedMultiplier,
  activeScenario, onSelectScenario,
}) => (
  <div className="focus-settings">
    <label className="focus-setting">
      <span>Scenario</span>
      <select value={activeScenario} onChange={event => onSelectScenario(event.target.value as ScenarioPreset)}>
        {scenarios.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <label className="focus-setting">
      <span>Mode</span>
      <select value={mode} onChange={event => onChangeMode(event.target.value as PushMode)}>
        <option value="discrete">Discrete</option>
        <option value="analog">Analog</option>
      </select>
    </label>
    <label className="focus-setting">
      <span>Overflow</span>
      <select value={overflow} disabled={mode === 'analog'} onChange={event => onChangeOverflow(event.target.value as PushOverflow)}>
        <option value="block" disabled={mode === 'analog'}>Block</option>
        <option value="drop-oldest">{mode === 'analog' ? 'Coalesce latest' : 'Drop oldest'}</option>
        <option value="drop-newest" disabled={mode === 'analog'}>Drop newest</option>
        <option value="error" disabled={mode === 'analog'}>Error</option>
      </select>
    </label>
    <label className="focus-setting">
      <span>Capacity</span>
      <select value={capacity} onChange={event => onChangeCapacity(Number(event.target.value))}>
        {(mode === 'analog' ? [1, 2, 3] : [3, 4, 6, 8]).map(value => <option value={value} key={value}>{value} slots</option>)}
      </select>
    </label>
    <label className="focus-setting focus-setting-slider">
      <span>Produce every <strong>{producerRate.toFixed(1)}s</strong></span>
      <input type="range" min="0.4" max="3.5" step="0.1" value={producerRate}
        onChange={event => onChangeProducerRate(Number(event.target.value))} />
    </label>
    <label className="focus-setting focus-setting-slider">
      <span>Consume every <strong>{consumerRate.toFixed(1)}s</strong></span>
      <input type="range" min="0.4" max="3.5" step="0.1" value={consumerRate}
        onChange={event => onChangeConsumerRate(Number(event.target.value))} />
    </label>
    <label className="focus-setting">
      <span>Playback speed</span>
      <select value={speedMultiplier} onChange={event => onChangeSpeedMultiplier(Number(event.target.value))}>
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
      </select>
    </label>
  </div>
);
