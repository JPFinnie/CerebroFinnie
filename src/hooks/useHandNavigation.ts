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
  panPoint: { x: number; y: number } | null;
  separation: number;
  lastVideoTime: number;
  lastUiUpdate: number;
  lastPointingUp: boolean;
  lastPointingUpTime: number;
};

type NavigationHand =
  | {
      landmarks: HandPoint[];
      mode: 'gesture' | 'fallback';
      label: 'Victory' | 'Two-finger pose';
    }
  | {
      landmarks: HandPoint[];
      mode: 'gesture';
      label: 'Closed_Fist' | 'Open_Palm' | 'Pointing_Up';
    };

const DEFAULT_SIGNAL: HandNavigationSignal = {
  active: false,
  deltaAzimuth: 0,
  deltaPolar: 0,
  zoomDelta: 0,
  panDelta: { x: 0, y: 0 },
  cursor: { x: 0.5, y: 0.5 },
  separation: 0,
  gestureTrigger: null,
};

const DEFAULT_OVERLAY: HandOverlayState = {
  status: 'idle',
  message: 'Camera offline',
  cursor: null,
  separation: 0,
};

const READY_MESSAGE = 'Victory orbits · Palm pans · Fist zooms · Point to select (×2 open note)';

export function useHandNavigation(): HandNavigationController {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const commandRef = useRef<HandNavigationSignal>({ ...DEFAULT_SIGNAL });
  const recognizerRef = useRef<GestureRecognizerInstance | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const gestureMemoryRef = useRef<GestureMemory>({
    midpoint: null,
    panPoint: null,
    separation: 0,
    lastVideoTime: -1,
    lastUiUpdate: 0,
    lastPointingUp: false,
    lastPointingUpTime: 0,
  });

  const [overlay, setOverlay] = useState<HandOverlayState>(DEFAULT_OVERLAY);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const togglePause = useCallback(() => {
    setIsPaused((p) => !p);
  }, []);

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
      panPoint: null,
      separation: 0,
      lastVideoTime: -1,
      lastUiUpdate: 0,
      lastPointingUp: false,
      lastPointingUpTime: 0,
    };

    commandRef.current = { ...DEFAULT_SIGNAL };
    setIsRunning(false);
    setIsPaused(false);
    setOverlay(DEFAULT_OVERLAY);
  }, []);

  const updateSignal = useCallback(
    (result: GestureRecognizerResultLike | null, now: number) => {
      const activeHand = getNavigationHand(result);
      const memory = gestureMemoryRef.current;

      if (!activeHand) {
        memory.lastPointingUp = false;
        commandRef.current.active = false;
        commandRef.current.panDelta = { x: 0, y: 0 };

        if (now - memory.lastUiUpdate > 120) {
          memory.midpoint = null;
          memory.panPoint = null;
          memory.separation = 0;
          memory.lastUiUpdate = now;
          setOverlay({
            status: isRunning ? 'ready' : 'idle',
            message: isRunning ? READY_MESSAGE : 'Camera offline',
            cursor: null,
            separation: 0,
            landmarks: [],
            gestureLabel: '',
          });
        }

        return;
      }

      // When paused, only track cursor position
      if (isPausedRef.current) {
        commandRef.current.active = false;
        commandRef.current.deltaAzimuth = 0;
        commandRef.current.deltaPolar = 0;
        commandRef.current.zoomDelta = 0;
        commandRef.current.panDelta = { x: 0, y: 0 };
        commandRef.current.cursor = { x: 1 - activeHand.landmarks[0].x, y: activeHand.landmarks[0].y };

        if (now - memory.lastUiUpdate > 90) {
          memory.lastUiUpdate = now;
          setOverlay({
            status: 'active',
            message: 'Frozen — point at a node to select it',
            cursor: commandRef.current.cursor,
            separation: 0,
            landmarks: result?.landmarks ?? [],
            gestureLabel: activeHand.label,
          });
        }
        return;
      }

      // Zoom: Closed_Fist
      if (activeHand.label === 'Closed_Fist') {
        commandRef.current.active = true;
        commandRef.current.deltaAzimuth = 0;
        commandRef.current.deltaPolar = 0;
        commandRef.current.zoomDelta = 0.04;
        commandRef.current.cursor = { x: 1 - activeHand.landmarks[0].x, y: activeHand.landmarks[0].y };
        commandRef.current.panDelta = { x: 0, y: 0 };
        memory.midpoint = null;
        memory.panPoint = null;
        memory.lastPointingUp = false;

        if (now - memory.lastUiUpdate > 90) {
          memory.lastUiUpdate = now;
          setOverlay({
            status: 'active',
            message: 'Zoom in',
            cursor: commandRef.current.cursor,
            separation: memory.separation,
            landmarks: result?.landmarks ?? [],
            gestureLabel: 'Closed_Fist',
          });
        }
        return;
      }

      // Pan: Open_Palm — track landmark 9 (middle knuckle, more stable)
      if (activeHand.label === 'Open_Palm') {
        const hand = activeHand.landmarks;
        const panPoint = {
          x: 1 - hand[9].x,
          y: hand[9].y,
        };
        const smoothPanPoint = memory.panPoint
          ? {
              x: lerp(memory.panPoint.x, panPoint.x, 0.45),
              y: lerp(memory.panPoint.y, panPoint.y, 0.45),
            }
          : panPoint;

        if (memory.panPoint) {
          commandRef.current.active = true;
          commandRef.current.deltaAzimuth = 0;
          commandRef.current.deltaPolar = 0;
          commandRef.current.zoomDelta = 0;
          commandRef.current.panDelta = {
            x: clamp((smoothPanPoint.x - memory.panPoint.x) * 2.4, -0.16, 0.16),
            y: clamp((smoothPanPoint.y - memory.panPoint.y) * 2.4, -0.16, 0.16),
          };
          commandRef.current.cursor = smoothPanPoint;
        } else {
          commandRef.current = { ...DEFAULT_SIGNAL, active: false, cursor: smoothPanPoint };
        }

        memory.panPoint = smoothPanPoint;
        memory.midpoint = null;
        memory.lastPointingUp = false;

        if (now - memory.lastUiUpdate > 90) {
          memory.lastUiUpdate = now;
          setOverlay({
            status: 'active',
            message: 'Panning',
            cursor: smoothPanPoint,
            separation: 0,
            landmarks: result?.landmarks ?? [],
            gestureLabel: 'Open_Palm',
          });
        }
        return;
      }

      // Select / Open: Pointing_Up — rising-edge tap detection
      if (activeHand.label === 'Pointing_Up') {
        const hand = activeHand.landmarks;
        const cursor = { x: 1 - hand[8].x, y: hand[8].y };
        const isRisingEdge = !memory.lastPointingUp;

        if (isRisingEdge) {
          const timeSinceLast = now - memory.lastPointingUpTime;
          if (timeSinceLast < 600) {
            // Double tap → open/close note
            commandRef.current.gestureTrigger = { type: 'open', cursor };
          } else {
            // Single tap → select nearest node
            commandRef.current.gestureTrigger = { type: 'select', cursor };
          }
          memory.lastPointingUpTime = now;
        }

        memory.lastPointingUp = true;
        commandRef.current.active = false;
        commandRef.current.deltaAzimuth = 0;
        commandRef.current.deltaPolar = 0;
        commandRef.current.zoomDelta = 0;
        commandRef.current.panDelta = { x: 0, y: 0 };
        commandRef.current.cursor = cursor;
        memory.midpoint = null;
        memory.panPoint = null;

        if (now - memory.lastUiUpdate > 90) {
          memory.lastUiUpdate = now;
          setOverlay({
            status: 'active',
            message: 'Point to select • double = open note',
            cursor,
            separation: 0,
            landmarks: result?.landmarks ?? [],
            gestureLabel: 'Pointing_Up',
          });
        }
        return;
      }

      // Orbit: Victory / Two-finger pose
      const hand = activeHand.landmarks;
      const midpoint = {
        x: 1 - (hand[8].x + hand[12].x) / 2,
        y: (hand[8].y + hand[12].y) / 2,
      };
      const separation = distance(hand[8], hand[12]);
      const smoothMidpoint = memory.midpoint
        ? {
            x: lerp(memory.midpoint.x, midpoint.x, 0.38),
            y: lerp(memory.midpoint.y, midpoint.y, 0.38),
          }
        : midpoint;
      const smoothSeparation = memory.separation ? lerp(memory.separation, separation, 0.38) : separation;

      if (memory.midpoint) {
        commandRef.current.active = true;
        commandRef.current.deltaAzimuth = clamp((smoothMidpoint.x - memory.midpoint.x) * 1.8, -0.08, 0.08);
        commandRef.current.deltaPolar = clamp((smoothMidpoint.y - memory.midpoint.y) * 1.5, -0.06, 0.06);
        commandRef.current.zoomDelta = clamp((smoothSeparation - memory.separation) * 5, -0.12, 0.12);
        commandRef.current.cursor = smoothMidpoint;
        commandRef.current.separation = smoothSeparation;
        commandRef.current.panDelta = { x: 0, y: 0 };
      } else {
        commandRef.current = {
          ...DEFAULT_SIGNAL,
          active: false,
          cursor: smoothMidpoint,
          separation: smoothSeparation,
        };
      }

      memory.midpoint = smoothMidpoint;
      memory.separation = smoothSeparation;
      memory.panPoint = null;
      memory.lastPointingUp = false;

      if (now - memory.lastUiUpdate > 90) {
        memory.lastUiUpdate = now;
        setOverlay({
          status: 'active',
          message:
            activeHand.mode === 'gesture'
              ? 'Orbiting'
              : 'Orbiting (fallback)',
          cursor: smoothMidpoint,
          separation: smoothSeparation,
          landmarks: result?.landmarks ?? [],
          gestureLabel: activeHand.label,
        });
      }
    },
    [isRunning],
  );

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
        message: 'Loading gesture recognizer…',
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
          categoryAllowlist: ['Victory', 'Closed_Fist', 'Open_Palm', 'Pointing_Up'],
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
        panPoint: null,
        separation: 0,
        lastVideoTime: -1,
        lastUiUpdate: 0,
        lastPointingUp: false,
        lastPointingUpTime: 0,
      };

      setIsRunning(true);
      setOverlay({
        status: 'ready',
        message: READY_MESSAGE,
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
    isPaused,
    start,
    stop,
    togglePause,
  };
}

function getNavigationHand(result: GestureRecognizerResultLike | null): NavigationHand | null {
  if (!result) {
    return null;
  }

  for (let index = 0; index < result.landmarks.length; index += 1) {
    const landmarks = result.landmarks[index];
    const topGesture = result.gestures[index]?.[0];

    if (
      (topGesture?.categoryName === 'Victory' ||
        topGesture?.categoryName === 'Closed_Fist' ||
        topGesture?.categoryName === 'Open_Palm' ||
        topGesture?.categoryName === 'Pointing_Up') &&
      (topGesture.score ?? 0) >= 0.4
    ) {
      return {
        landmarks,
        mode: 'gesture',
        label: topGesture.categoryName,
      } as NavigationHand;
    }
  }

  for (const landmarks of result.landmarks) {
    if (isTwoFingerPose(landmarks)) {
      return {
        landmarks,
        mode: 'fallback',
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
