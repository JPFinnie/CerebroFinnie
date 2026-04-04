import { useEffect, useRef, useState, type RefObject } from 'react';
import type { HandOverlayState } from '../types';

// Standard MediaPipe hand connections
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],           // index
  [0, 9], [9, 10], [10, 11], [11, 12],      // middle
  [0, 13], [13, 14], [14, 15], [15, 16],    // ring
  [0, 17], [17, 18], [18, 19], [19, 20],    // pinky
  [5, 9], [9, 13], [13, 17],                // palm cross
];

// Landmarks to highlight per gesture
const GESTURE_HIGHLIGHTS: Record<string, number[]> = {
  Victory: [8, 12],
  Pointing_Up: [8],
  Closed_Fist: [0],
  Open_Palm: [4, 8, 12, 16, 20],
  Thumb_Up: [4],
};

const GESTURE_GUIDE = [
  { label: 'Victory', emoji: '✌', desc: 'Orbit' },
  { label: 'Pointing_Up', emoji: '☝', desc: 'Pan' },
  { label: 'Closed_Fist', emoji: '✊', desc: 'Zoom in' },
  { label: 'Open_Palm', emoji: '🖐', desc: 'Zoom out' },
  { label: 'Thumb_Up', emoji: '👍', desc: 'Pause' },
];

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isLoading = handOverlay.status === 'loading';
  const isActive = isCameraRunning || isLoading;
  const activeGesture = handOverlay.gestureLabel ?? '';

  // Draw hand skeleton on canvas whenever landmarks change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const landmarks = handOverlay.landmarks;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!landmarks || landmarks.length === 0) return;

    const W = canvas.width;
    const H = canvas.height;
    const highlights = GESTURE_HIGHLIGHTS[activeGesture] ?? [];

    for (const hand of landmarks) {
      if (!hand || hand.length < 21) continue;

      // Draw connections
      ctx.strokeStyle = 'rgba(255, 209, 139, 0.65)';
      ctx.lineWidth = 1.5;
      for (const [a, b] of HAND_CONNECTIONS) {
        const pa = hand[a];
        const pb = hand[b];
        if (!pa || !pb) continue;
        // Mirror x because video is CSS-mirrored
        ctx.beginPath();
        ctx.moveTo((1 - pa.x) * W, pa.y * H);
        ctx.lineTo((1 - pb.x) * W, pb.y * H);
        ctx.stroke();
      }

      // Draw landmarks
      for (let i = 0; i < hand.length; i++) {
        const lm = hand[i];
        if (!lm) continue;
        const x = (1 - lm.x) * W;
        const y = lm.y * H;
        const isHighlit = highlights.includes(i);

        ctx.beginPath();
        ctx.arc(x, y, isHighlit ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isHighlit ? 'rgba(255, 215, 100, 0.95)' : 'rgba(255, 255, 255, 0.6)';
        ctx.fill();
      }
    }
  }, [handOverlay.landmarks, activeGesture]);

  return (
    <>
      {/* Bottom-left gesture toolbar pill */}
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

      {/* Gesture reference guide — above toolbar when active */}
      {isActive && (
        <div className="gesture-guide" role="list" aria-label="Gesture controls">
          {GESTURE_GUIDE.map((g) => (
            <div
              key={g.label}
              className={`gesture-chip ${activeGesture === g.label ? 'gesture-chip--active' : ''}`}
              role="listitem"
            >
              <span className="gesture-chip-icon">{g.emoji}</span>
              <span>{g.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Camera preview inset — always in DOM when active (MediaPipe needs video element) */}
      {isActive && (
        <div className={`camera-preview-inset ${showPreview ? 'camera-preview-inset--visible' : ''}`}>
          <div className={isCameraRunning ? 'camera-preview live' : 'camera-preview'}>
            <video ref={videoRef} autoPlay muted playsInline />
            <canvas
              ref={canvasRef}
              className="hand-skeleton-canvas"
              width={320}
              height={180}
            />
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
