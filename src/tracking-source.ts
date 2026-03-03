import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import { SAMPLE_IMAGES, SAMPLE_ROUTE_PREFIX } from "./tracking-constants";
import type { TrackingSource } from "./tracking-types";

/**
 * Starts camera capture and attaches the stream to the hidden video element.
 *
 * @param video - Hidden video element used by FaceLandmarker for frame input
 * @returns A promise that resolves once playback begins
 */
async function setupCamera(video: HTMLVideoElement): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720 },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

/**
 * Creates a PoseLandmarker configured for single-pose tracking.
 *
 * Running mode is selected based on frame source type (live camera vs. still sample).
 *
 * @param runningMode - MediaPipe running mode for frame processing
 * @returns Configured PoseLandmarker instance
 */
async function setupPoseLandmarker(
  runningMode: "VIDEO" | "IMAGE",
): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
  );

  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode,
    numPoses: 1,
    outputSegmentationMasks: false,
  });
}

/**
 * Creates a FaceLandmarker configured for single-face head orientation tracking.
 *
 * The resulting landmarks are used to extract head yaw/roll so the suit rotation
 * can stay aligned with the face cutout during independent head movement.
 *
 * @param runningMode - MediaPipe running mode for frame processing
 * @returns Configured FaceLandmarker instance
 */
async function setupFaceLandmarker(
  runningMode: "VIDEO" | "IMAGE",
): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
  );

  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode,
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
}

/**
 * Resolves sample-photo mode from the current URL path.
 *
 * Supports `/samples/<sample-id>` where sample-id is one of the configured
 * SAMPLE_IMAGES keys, and also supports `/?sample=<sample-id>`.
 *
 * @returns Sample id when route matches a configured sample, otherwise null
 */
function sampleIdFromRoute(): string | null {
  const querySampleId = new URLSearchParams(window.location.search).get("sample");
  if (querySampleId && SAMPLE_IMAGES[querySampleId]) {
    return querySampleId;
  }

  const path = window.location.pathname;
  if (!path.startsWith(SAMPLE_ROUTE_PREFIX)) {
    return null;
  }

  const sampleId = decodeURIComponent(path.slice(SAMPLE_ROUTE_PREFIX.length));
  return SAMPLE_IMAGES[sampleId] ? sampleId : null;
}

/**
 * Loads an image from URL with CORS enabled for pixel access by MediaPipe.
 *
 * @param src - Image URL to load
 * @returns Loaded image element ready for pose detection
 */
async function loadImageSource(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  await image.decode();
  return image;
}

/**
 * Configures either live camera input or sample-photo test input from route.
 *
 * Sample routes (`/samples/<id>`) render the selected image behind the 3D canvas
 * and avoid requesting webcam permissions.
 *
 * @param video - Hidden video element used for camera mode
 * @returns Active tracking source configuration
 */
async function setupTrackingSource(video: HTMLVideoElement): Promise<TrackingSource> {
  const sampleId = sampleIdFromRoute();
  if (!sampleId) {
    await setupCamera(video);
    return {
      mode: "camera",
      frameSource: video,
      release: () => {
        const stream = video.srcObject as MediaStream | null;
        stream?.getTracks().forEach((track) => track.stop());
      },
    };
  }

  const sampleUrl = SAMPLE_IMAGES[sampleId];
  const sampleImage = await loadImageSource(sampleUrl);
  const visibleImage = document.createElement("img");
  visibleImage.id = "sample-image";
  visibleImage.alt = `Sample person photo: ${sampleId}`;
  visibleImage.src = sampleUrl;
  document.body.appendChild(visibleImage);

  return {
    mode: "sample",
    frameSource: sampleImage,
    release: () => {
      visibleImage.remove();
    },
  };
}

export { setupFaceLandmarker, setupPoseLandmarker, setupTrackingSource };
