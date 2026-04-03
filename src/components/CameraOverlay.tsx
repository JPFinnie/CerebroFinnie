import type { RefObject } from 'react';
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
  const isLoading = handOverlay.status === 'loading';
  const showFeed = isCameraRunning || isLoading;

  if (!showFeed) {
    return (
      <div className="camera-overlay idle">
        <button type="button" className="camera-button" onClick={onToggle}>
          Start gesture control
        </button>
      </div>
    );
  }

  return (
    <div className="camera-overlay">
      <div className="camera-overlay-header">
        <span className={`status-dot ${handOverlay.status}`} />
        <p className="mini-label">Hand nav</p>
        {isPaused && <span className="pause-badge">PAUSED</span>}
      </div>

      <div className={isCameraRunning ? 'camera-preview live' : 'camera-preview'}>
        <video ref={videoRef} autoPlay muted playsInline />
        {handOverlay.cursor ? (
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

      <div className="camera-overlay-actions">
        {isCameraRunning ? (
          <button type="button" className="camera-button" onClick={onTogglePause}>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        ) : null}
        <button type="button" className="camera-button" onClick={onToggle}>
          Stop
        </button>
      </div>

      <p className="support-copy camera-tip">{handOverlay.message}</p>
    </div>
  );
}
