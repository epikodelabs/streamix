import React from 'react';
import { BookOpen, RotateCcw, Volume2, VolumeX } from 'lucide-react';

interface TopBarProps {
  onReset: () => void;
  onOpenGuide: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  activeSection: string;
  onSelectSection: (section: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  onReset, onOpenGuide, soundEnabled, onToggleSound, onSelectSection,
}) => (
  <header className="focus-topbar">
    <div className="focus-toolbar">
      <button className="focus-brand" type="button" onClick={() => onSelectSection('visualizer')}>
        <span className="focus-brand-mark" aria-hidden="true">S</span>
        <span>Streamix <em>/ FIFO</em></span>
      </button>
      <div className="focus-toolbar-actions">
        <button className="focus-toolbar-icon" onClick={onToggleSound}
          aria-label={soundEnabled ? 'Mute sound' : 'Enable sound'} title={soundEnabled ? 'Mute sound' : 'Enable sound'}>
          {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
        <button className="focus-toolbar-button" onClick={onOpenGuide}><BookOpen size={15} /><span>Documentation</span></button>
        <button className="focus-toolbar-button" onClick={onReset}><RotateCcw size={15} /><span>Reset</span></button>
      </div>
    </div>
  </header>
);
