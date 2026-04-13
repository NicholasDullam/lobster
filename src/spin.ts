import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import "./spin.css";
import { resolveModelConfig } from "./model-config";
import {
  attachModelDecorations,
  type DecorationState,
} from "./model-decorations";

const CAMERA_FOV = 45;
const CAMERA_NEAR = 0.01;
const CAMERA_FAR = 100;
const SPIN_SPEED_RADIANS_PER_SECOND = 0.75;
const activeModelConfig = resolveModelConfig(window.location.search);

document.title = `${activeModelConfig.displayName} Model Spin Preview`;
const metaDescription = document.querySelector<HTMLMetaElement>(
  'meta[name="description"]',
);
if (metaDescription) {
  metaDescription.setAttribute(
    "content",
    `Centered spinning preview of the ${activeModelConfig.displayName} face filter model.`,
  );
}

const canvas = document.getElementById("spin-canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Expected #spin-canvas to be a canvas element.");
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  CAMERA_FOV,
  window.innerWidth / window.innerHeight,
  CAMERA_NEAR,
  CAMERA_FAR,
);

scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(1.5, 2.5, 2.5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb8c3ff, 0.5);
fillLight.position.set(-1.5, 0.5, -2.5);
scene.add(fillLight);

const root = new THREE.Group();
scene.add(root);

const clock = new THREE.Clock();
const loader = new GLTFLoader();
let updateDecorations = (_state: DecorationState): void => undefined;

/**
 * Loads the active model and places it so it rotates around its geometric center.
 *
 * Computes bounds to recenter the mesh at origin, then positions the camera so
 * the entire model stays comfortably in frame.
 *
 * @returns Promise that resolves after the model is loaded and framed
 */
async function loadModel(): Promise<void> {
  const gltf = await loader.loadAsync(activeModelConfig.modelUrl);
  const model = gltf.scene;

  const bounds = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  bounds.getCenter(center);
  bounds.getSize(size);

  model.position.sub(center);

  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const distance =
    (maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5)))) *
    1.4;
  camera.position.set(0, size.y * 0.1, distance);
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 20;
  camera.updateProjectionMatrix();

  updateDecorations =
    attachModelDecorations(model, activeModelConfig, bounds) ??
    (() => undefined);
  root.add(model);
}

/**
 * Updates camera aspect ratio and renderer size to match viewport changes.
 */
function handleResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", handleResize);

/**
 * Runs the render loop and applies continuous Y-axis rotation to the model.
 */
function animate(): void {
  const deltaSeconds = clock.getDelta();
  root.rotation.y += SPIN_SPEED_RADIANS_PER_SECOND * deltaSeconds;
  updateDecorations({
    elapsedSeconds: clock.elapsedTime,
    upwardTiltAmount: 0,
  });
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

loadModel()
  .then(() => {
    animate();
  })
  .catch((error: unknown) => {
    console.error(
      `Failed to load ${activeModelConfig.displayName} spin preview model:`,
      error,
    );
  });
