import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

const LM_NOSE_TIP = 1;
const LM_LEFT_EYE = 33;
const LM_RIGHT_EYE = 263;

const MODEL_URL = "/models/filter.glb";
const POS_SMOOTH = 0.65;
const ROT_SMOOTH = 0.75;

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
 * Creates a FaceLandmarker configured for single-face video tracking.
 *
 * Facial transformation matrices are enabled for stable orientation tracking.
 *
 * @returns Configured FaceLandmarker instance
 */
async function setupFaceLandmarker(): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
  );

  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  });
}

/**
 * Converts normalized image-space landmark coordinates into NDC.
 *
 * @param landmark - Landmark with normalized x/y in image coordinates
 * @returns NDC x/y in the range [-1, 1]
 */
function ndcFromLandmark(landmark: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return {
    x: (landmark.x - 0.5) * 2,
    y: -(landmark.y - 0.5) * 2,
  };
}

/**
 * Computes normalized inter-ocular distance used for model scaling.
 *
 * @param a - Left eye landmark
 * @param b - Right eye landmark
 * @returns Euclidean distance between landmarks in normalized image space
 */
function eyeDistanceNorm(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Extracts head orientation from MediaPipe facial transformation matrix.
 *
 * Includes a one-time Y-axis inversion fix so orientation aligns with three.js.
 *
 * @param result - FaceLandmarker detection result for the current frame
 * @returns Quaternion rotation for the tracked face, or null when unavailable
 */
function quatFromFacialMatrix(
  result: FaceLandmarkerResult,
): THREE.Quaternion | null {
  const matrix = result.facialTransformationMatrixes?.[0];
  if (!matrix?.data || matrix.data.length < 16) {
    return null;
  }

  const mat = new THREE.Matrix4().fromArray(matrix.data);
  mat.setPosition(0, 0, 0);

  const q = new THREE.Quaternion().setFromRotationMatrix(mat);
  const flipY = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(Math.PI, 0, 0),
  );
  q.multiply(flipY);
  return q;
}

/**
 * Initializes tracking and render loop for the OBS 3D face filter overlay.
 *
 * @returns A promise that resolves when initial setup is complete
 */
async function main(): Promise<void> {
  const video = document.querySelector<HTMLVideoElement>("#video");
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  if (!video || !canvas) {
    throw new Error("Expected #video and #canvas elements in index.html.");
  }

  await setupCamera(video);
  const faceLandmarker = await setupFaceLandmarker();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
  });
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  camera.position.z = 5;

  const light = new THREE.DirectionalLight(0xffffff, 1.25);
  light.position.set(1, 2, 3);
  scene.add(light, new THREE.AmbientLight(0xffffff, 0.6));

  const anchor = new THREE.Group();
  scene.add(anchor);

  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const model = gltf.scene;
  anchor.add(model);
  model.scale.setScalar(0.5);

  const smoothedPos = new THREE.Vector3(0, 0, 0);
  const smoothedQuat = new THREE.Quaternion();

  const tick = (): void => {
    const now = performance.now();
    const result = faceLandmarker.detectForVideo(video, now);

    if (result.faceLandmarks?.length) {
      const landmarks = result.faceLandmarks[0];
      const nose = landmarks[LM_NOSE_TIP];
      const leftEye = landmarks[LM_LEFT_EYE];
      const rightEye = landmarks[LM_RIGHT_EYE];

      if (nose && leftEye && rightEye) {
        const { x, y } = ndcFromLandmark(nose);
        smoothedPos.lerp(new THREE.Vector3(x, y, 0), 1 - POS_SMOOTH);
        anchor.position.copy(smoothedPos);

        const eyeDist = eyeDistanceNorm(leftEye, rightEye);
        const targetScale = THREE.MathUtils.clamp(eyeDist * 2.2, 0.15, 1.25);
        anchor.scale.setScalar(targetScale);

        const matrixQuat = quatFromFacialMatrix(result);
        if (matrixQuat) {
          smoothedQuat.slerp(matrixQuat, 1 - ROT_SMOOTH);
        } else {
          const roll = Math.atan2(
            rightEye.y - leftEye.y,
            rightEye.x - leftEye.x,
          );
          const fallbackQuat = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0, 0, -roll),
          );
          smoothedQuat.slerp(fallbackQuat, 1 - ROT_SMOOTH);
        }
        anchor.quaternion.copy(smoothedQuat);
        anchor.visible = true;
      } else {
        anchor.visible = false;
      }
    } else {
      anchor.visible = false;
    }

    const width = canvas.clientWidth | 0;
    const height = canvas.clientHeight | 0;
    if (canvas.width !== width || canvas.height !== height) {
      renderer.setSize(width, height, false);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

main().catch((error: unknown) => {
  console.error("Failed to start face filter demo:", error);
});
