import { useState, type RefObject } from 'react';
import type { HandOverlayState } from '../types';

type CameraOverlayProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  handOverlay: HandOverlayState;
  isCameraRunning: boolean;
  isPaused: boolean;
  onToggle: () => void;
  onTogglePause: () => void;
};

export function CameraOverlay({
  videoRef,
  handOverlay,
  isCameraRunning,
  isPaused,
  onToggle,
  onTogglePause,
}: CameraOverlayProps) {
  const [showPreview, setShowPreview] = useState(false);
  const isLoading = handOverlay.status === 'loading';
  const isActive = isCameraRunning || isLoading;

  return (
    <>
      {/* Bottom-center gesture toolbar pill */}
      <div className="gesture-toolbar">
        {!isActive ? (
          <button type="button" className="gesture-toolbar-btn gesture-toolbar-btn--primary" onClick={onToggle}>
            <span className="gesture-icon">✋</span>
            Start Gestures
          </button>
        ) : (
          <>
            <span className="gesture-status-dot" data-status={handOverlay.status} />
            <span className="gesture-toolbar-label">
              {isPaused ? 'Paused — dwell to select' : isLoading ? 'Loading…' : handOverlay.message || 'Live'}
            </span>
            <div className="gesture-toolbar-divider" />
            <button
              type="button"
              className={`gesture-toolbar-btn ${isPaused ? 'gesture-toolbar-btn--active' : ''}`}
              onClick={onTogglePause}
              title={isPaused ? 'Resume gesture control' : 'Pause (enables node dwell-select)'}
            >
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button
              type="button"
              className={`gesture-toolbar-btn gesture-toolbar-btn--ghost ${showPreview ? 'gesture-toolbar-btn--active' : ''}`}
              onClick={() => setShowPreview((v) => !v)}
              title="Toggle camera preview"
            >
              Feed
            </button>
            <button
              type="button"
              className="gesture-toolbar-btn gesture-toolbar-btn--stop"
              onClick={onToggle}
              title="Stop gesture control"
            >
              ✕
            </button>
          </>
        )}
      </div>

      {/* Camera preview inset — always in DOM when active (MediaPipe needs it), shown/hidden via CSS */}
      {isActive && (
        <div className={`camera-preview-inset ${showPreview ? 'camera-preview-inset--visible' : ''}`}>
          <div className={isCameraRunning ? 'camera-preview live' : 'camera-preview'}>
            <video ref={videoRef} autoPlay muted playsInline />
            {handOverlay.cursor && showPreview ? (
              <span
                className="gesture-cursor"
                style={{
                  left: `${handOverlay.cursor.x * 100}%`,
                  top: `${handOverlay.cursor.y * 100}%`,
                }}
              />
            ) : null}
            <div className="camera-status">
              <span className={`status-dot ${handOverlay.status}`} />
              <span>{handOverlay.status}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
