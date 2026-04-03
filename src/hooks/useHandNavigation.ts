import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandNavigationController, HandNavigationSignal, HandOverlayState } from '../types';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const MODEL_ASSET = 'https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task';

type HandPoint = {
  x: number;
  y: number;
  z: number;
};

type GestureCategory = {
  categoryName?: string;
  score?: number;
};

type GestureRecognizerResultLike = {
  landmarks: HandPoint[][];
  gestures: GestureCategory[][];
};

type GestureRecognizerInstance = {
  close: () => void;
  recognizeForVideo: (video: HTMLVideoElement, timestamp: number) => GestureRecognizerResultLike;
};

type GestureMemory = {
  midpoint: { x: number; y: number } | null;
  separation: number;
  roll: number;
  lastVideoTime: number;
  lastUiUpdate: number;
};

const DEFAULT_SIGNAL: HandNavigationSignal = {
  active: false,
  panX: 0,
  panZ: 0,
  tiltDelta: 0,
  zoomDelta: 0,
  cursor: { x: 0.5, y: 0.5 },
  separation: 0,
  roll: 0,
};

const DEFAULT_OVERLAY: HandOverlayState = {
  status: 'idle',
  message: 'Camera offline',
  cursor: null,
  separation: 0,
};

export function useHandNavigation(): HandNavigationController {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const commandRef = useRef<HandNavigationSignal>({ ...DEFAULT_SIGNAL });
  const recognizerRef = useRef<GestureRecognizerInstance | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const gestureMemoryRef = useRef<GestureMemory>({
    midpoint: null,
    separation: 0,
    roll: 0,
    lastVideoTime: -1,
    lastUiUpdate: 0,
  });

  const [overlay, setOverlay] = useState<HandOverlayState>(DEFAULT_OVERLAY);
  const [isRunning, setIsRunning] = useState(false);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    recognizerRef.current?.close();
    recognizerRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    gestureMemoryRef.current = {
      midpoint: null,
      separation: 0,
      roll: 0,
      lastVideoTime: -1,
      lastUiUpdate: 0,
    };

    commandRef.current = { ...DEFAULT_SIGNAL };
    setIsRunning(false);
    setOverlay(DEFAULT_OVERLAY);
  }, []);

  const updateSignal = useCallback((result: GestureRecognizerResultLike | null, now: number) => {
    const activeHand = getNavigationHand(result);

    if (!activeHand) {
      commandRef.current.active = false;

      if (now - gestureMemoryRef.current.lastUiUpdate > 120) {
        gestureMemoryRef.current.midpoint = null;
        gestureMemoryRef.current.separation = 0;
        gestureMemoryRef.current.roll = 0;
        gestureMemoryRef.current.lastUiUpdate = now;
        setOverlay({
          status: isRunning ? 'ready' : 'idle',
          message: isRunning ? 'Make a Victory sign to pan, tilt, and zoom' : 'Camera offline',
          cursor: null,
          separation: 0,
        });
      }

      return;
    }

    const hand = activeHand.landmarks;
    const midpoint = {
      x: 1 - (hand[8].x + hand[12].x) / 2,
      y: (hand[8].y + hand[12].y) / 2,
    };
    const separation = distance(hand[8], hand[12]);
    const roll = Math.atan2(hand[12].y - hand[8].y, hand[12].x - hand[8].x);
    const memory = gestureMemoryRef.current;
    const smoothMidpoint = memory.midpoint
      ? {
          x: lerp(memory.midpoint.x, midpoint.x, 0.38),
          y: lerp(memory.midpoint.y, midpoint.y, 0.38),
        }
      : midpoint;
    const smoothSeparation = memory.separation ? lerp(memory.separation, separation, 0.38) : separation;
    const smoothRoll = memory.midpoint ? lerpAngle(memory.roll, roll, 0.34) : roll;

    if (memory.midpoint) {
      commandRef.current.active = true;
      commandRef.current.panX = clamp((smoothMidpoint.x - memory.midpoint.x) * 8.8, -0.12, 0.12);
      commandRef.current.panZ = clamp((smoothMidpoint.y - memory.midpoint.y) * 8.8, -0.12, 0.12);
      commandRef.current.tiltDelta = clamp(normalizeAngle(smoothRoll - memory.roll) * 1.25, -0.085, 0.085);
      commandRef.current.zoomDelta = clamp((smoothSeparation - memory.separation) * 24, -0.18, 0.18);
      commandRef.current.cursor = smoothMidpoint;
      commandRef.current.separation = smoothSeparation;
      commandRef.current.roll = smoothRoll;
    } else {
      commandRef.current = {
        ...DEFAULT_SIGNAL,
        active: false,
        cursor: smoothMidpoint,
        separation: smoothSeparation,
        roll: smoothRoll,
      };
    }

    memory.midpoint = smoothMidpoint;
    memory.separation = smoothSeparation;
    memory.roll = smoothRoll;

    if (now - memory.lastUiUpdate > 90) {
      memory.lastUiUpdate = now;
      setOverlay({
        status: 'active',
        message:
          activeHand.mode === 'gesture'
            ? `Gesture live: ${activeHand.label} pan/tilt/zoom`
            : 'Gesture live: two-finger fallback pan/tilt/zoom',
        cursor: smoothMidpoint,
        separation: smoothSeparation,
      });
    }
  }, [isRunning]);

  const start = useCallback(async () => {
    if (isRunning) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setOverlay({
        status: 'error',
        message: 'Camera access is not available in this browser.',
        cursor: null,
        separation: 0,
      });
      return;
    }

    try {
      setOverlay({
        status: 'loading',
        message: 'Loading gesture recognizer...',
        cursor: null,
        separation: 0,
      });

      const [{ FilesetResolver, GestureRecognizer }, stream] = await Promise.all([
        import('@mediapipe/tasks-vision'),
        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 360 },
          },
          audio: false,
        }),
      ]);

      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);

      const gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_ASSET,
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.65,
        minHandPresenceConfidence: 0.65,
        minTrackingConfidence: 0.55,
        cannedGesturesClassifierOptions: {
          categoryAllowlist: ['Victory'],
          scoreThreshold: 0.4,
          maxResults: 1,
        },
      });

      recognizerRef.current = gestureRecognizer;
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        throw new Error('Camera preview is not mounted.');
      }

      video.srcObject = stream;
      video.playsInline = true;
      video.muted = true;
      await video.play();

      gestureMemoryRef.current = {
        midpoint: null,
        separation: 0,
        roll: 0,
        lastVideoTime: -1,
        lastUiUpdate: 0,
      };

      setIsRunning(true);
      setOverlay({
        status: 'ready',
        message: 'Make a Victory sign to pan, tilt, and zoom',
        cursor: null,
        separation: 0,
      });

      const tick = () => {
        const activeVideo = videoRef.current;
        const activeRecognizer = recognizerRef.current;

        if (!activeVideo || !activeRecognizer || activeVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          frameRef.current = requestAnimationFrame(tick);
          return;
        }

        const now = performance.now();
        if (activeVideo.currentTime !== gestureMemoryRef.current.lastVideoTime) {
          gestureMemoryRef.current.lastVideoTime = activeVideo.currentTime;
          const result = activeRecognizer.recognizeForVideo(activeVideo, now);
          updateSignal(result, now);
        }

        frameRef.current = requestAnimationFrame(tick);
      };

      frameRef.current = requestAnimationFrame(tick);
    } catch (error) {
      console.error(error);
      stop();
      setOverlay({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to start camera tracking.',
        cursor: null,
        separation: 0,
      });
    }
  }, [isRunning, stop, updateSignal]);

  useEffect(() => stop, [stop]);

  return {
    videoRef,
    commandRef,
    overlay,
    isRunning,
    start,
    stop,
  };
}

function getNavigationHand(result: GestureRecognizerResultLike | null) {
  if (!result) {
    return null;
  }

  for (let index = 0; index < result.landmarks.length; index += 1) {
    const landmarks = result.landmarks[index];
    const topGesture = result.gestures[index]?.[0];

    if (topGesture?.categoryName === 'Victory' && (topGesture.score ?? 0) >= 0.4) {
      return {
        landmarks,
        mode: 'gesture' as const,
        label: topGesture.categoryName,
      };
    }
  }

  for (const landmarks of result.landmarks) {
    if (isTwoFingerPose(landmarks)) {
      return {
        landmarks,
        mode: 'fallback' as const,
        label: 'Two-finger pose',
      };
    }
  }

  return null;
}

function isTwoFingerPose(hand: HandPoint[]) {
  const indexExtended = isExtended(hand, 8, 6, 5);
  const middleExtended = isExtended(hand, 12, 10, 9);
  const ringFolded = !isExtended(hand, 16, 14, 13);
  const pinkyFolded = !isExtended(hand, 20, 18, 17);

  return indexExtended && middleExtended && ringFolded && pinkyFolded;
}

function isExtended(hand: HandPoint[], tipIndex: number, pipIndex: number, mcpIndex: number) {
  return hand[tipIndex].y < hand[pipIndex].y && hand[pipIndex].y < hand[mcpIndex].y;
}

function distance(a: HandPoint, b: HandPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function normalizeAngle(value: number) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function lerpAngle(start: number, end: number, amount: number) {
  return start + normalizeAngle(end - start) * amount;
}
