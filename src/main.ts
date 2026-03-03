import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  applyCutoutToMaterial,
  applyTuningToMaterial,
  loadProfileArtifact,
  mergeProfileArtifact,
  profileFromQueryParams,
  resolveCutoutForMaterial,
  resolveFilterMaterialTuning,
  updateCutoutDebugState,
  updateCutoutMaterialState,
  DEFAULT_FILTER_MATERIAL_PROFILE,
  type FilterCutoutDebugState,
  type FilterMaterialProfile,
} from "./filter-material-profile";
import type {
  FaceLandmarkerResult,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  ANCHOR_WORLD_Z,
  BODY_AUTO_CENTER_X,
  BODY_OFFSET_X,
  BODY_OFFSET_Y,
  BODY_OFFSET_Z,
  BODY_POSITION_DEADBAND,
  BODY_POS_SMOOTH,
  BODY_ROTATION_DEADBAND_RAD,
  BODY_ROTATION_OFFSET_X,
  BODY_ROTATION_OFFSET_Y,
  BODY_ROTATION_OFFSET_Z,
  BODY_ROT_SMOOTH,
  BODY_SCALE_MULTIPLIER,
  BODY_SCALE_SMOOTH,
  DEBUG_ENABLED,
  FACE_ANCHOR_POSITION_BLEND_CAMERA,
  FACE_ANCHOR_POSITION_BLEND_SAMPLE,
  FACE_ANCHOR_SCALE_BLEND_CAMERA,
  FACE_ANCHOR_SCALE_BLEND_SAMPLE,
  FACE_ANCHOR_EYE_NOSE_BLEND_X,
  FACE_ANCHOR_EYE_NOSE_BLEND_Y,
  FACE_CUTOUT_CENTERING_WEIGHT_CAMERA,
  FACE_CUTOUT_CENTERING_WEIGHT_SAMPLE,
  FACE_EYE_DISTANCE_SMOOTH_DOWN,
  FACE_EYE_DISTANCE_SMOOTH_UP,
  FACE_SCALE_DYNAMIC_BLEND_MAX,
  FACE_SCALE_DYNAMIC_BLEND_MIN,
  FACE_SCALE_FIT_PADDING,
  FACE_SCALE_MAX,
  FACE_SCALE_MIN,
  FACE_SCALE_MULTIPLIER,
  FACE_WINDOW_WIDTH_FROM_EYE_DISTANCE,
  FM_LEFT_EYE_OUTER,
  FM_NOSE_TIP,
  FM_RIGHT_EYE_OUTER,
  HEAD_MAX_PITCH_DELTA_FROM_TORSO,
  HEAD_MAX_ROLL_DELTA_FROM_TORSO,
  HEAD_MAX_YAW_DELTA_FROM_TORSO,
  HEAD_PITCH_BLEND_WEIGHT,
  HEAD_PITCH_FROM_NOSE_OFFSET,
  HEAD_PITCH_NEUTRAL_NOSE_EYE_RATIO,
  HEAD_ROLL_BLEND_WEIGHT,
  HEAD_ROLL_FROM_YAW,
  HEAD_ROLL_SIGN,
  HEAD_YAW_BLEND_WEIGHT,
  HEAD_YAW_FROM_NOSE_OFFSET,
  LM_LEFT_HIP,
  LM_LEFT_SHOULDER,
  LM_RIGHT_HIP,
  LM_RIGHT_SHOULDER,
  MIN_FACE_EYE_DISTANCE,
  MODEL_OVERRIDES_URL,
  MODEL_URL,
  POSE_LOST_HIDE_DELAY_MS,
  SAMPLE_SCALE_MULTIPLIER,
  SAMPLE_SCALE_MAX,
  SAMPLE_SCALE_MIN,
  CAMERA_SCALE_MULTIPLIER,
  CAMERA_SCALE_MIN,
  CAMERA_SCALE_MAX,
  BODY_ROLL_FROM_SHOULDERS,
  BODY_MIN_VISIBILITY,
  SYNTHETIC_TORSO_LENGTH_FROM_SHOULDERS,
} from "./tracking-constants";
import {
  setupFaceLandmarker,
  setupPoseLandmarker,
  setupTrackingSource,
} from "./tracking-source";
import {
  isReliableLandmark,
  landmarkConfidence,
  landmarkDistanceForScale,
  ndcFromLandmark,
  ndcFromLandmarkContained,
  viewportNormalizedFromLandmarkContained,
  worldPointFromNdc,
} from "./landmark-helpers";
import type {
  CutoutDebugEntry,
  DebugOverlay,
  FaceAnchor,
  PoseLandmark,
  PrimaryCutoutAnchor,
  ProjectionContext,
  TorsoAnchor,
  TorsoAnchorOptions,
  TrackingSource,
} from "./tracking-types";

/**
 * Applies runtime material profile tuning to every mesh in the loaded model.
 *
 * Clones each material before mutation so edits remain local to this model
 * instance and do not leak into cached GLTF material references.
 *
 * @param model - Loaded GLTF scene root to traverse
 * @param profile - Active material tuning profile
 */
function applyFilterMaterialProfileToModel(
  model: THREE.Object3D,
  profile: FilterMaterialProfile,
  cutoutDebugState?: FilterCutoutDebugState,
): void {
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }

    const mesh = node;
    const meshName = mesh.name ?? "";
    const tuneMaterial = (material: THREE.Material): THREE.Material => {
      const materialName = material.name ?? "";
      const tuning = resolveFilterMaterialTuning(
        profile,
        meshName,
        materialName,
      );
      const clonedMaterial = material.clone();
      applyTuningToMaterial(clonedMaterial, tuning);
      if (cutoutDebugState) {
        // Tuning mode: keep suit semi-transparent for easier alignment.
        (
          clonedMaterial.userData as { filterBaseOpacity?: number }
        ).filterBaseOpacity = clonedMaterial.opacity;
        clonedMaterial.transparent = true;
        clonedMaterial.depthWrite = false;
        clonedMaterial.opacity = Math.min(
          clonedMaterial.opacity,
          cutoutDebugState.translucentMeshOpacity,
        );
      }
      const cutout = resolveCutoutForMaterial(profile, meshName, materialName);
      if (cutout) {
        applyCutoutToMaterial(clonedMaterial, cutout, cutoutDebugState);
      }
      if (tuning.renderOrder !== undefined) {
        mesh.renderOrder = tuning.renderOrder;
      }
      return clonedMaterial;
    };

    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(tuneMaterial);
      return;
    }

    mesh.material = tuneMaterial(mesh.material);
  });
}

/**
 * Adds wireframe helpers for cutout windows to visualize alignment.
 *
 * Each helper is attached to the matched mesh in local space, so translating
 * and scaling the model keeps the debug shape locked to the configured cutout.
 *
 * @param model - Loaded GLB scene root
 * @param profile - Active material profile containing cutouts
 */
function addCutoutDebugHelpers(
  model: THREE.Object3D,
  profile: FilterMaterialProfile,
): CutoutDebugEntry[] {
  const helperMaterial = new THREE.MeshBasicMaterial({
    color: 0x3fd4ff,
    wireframe: true,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
  });
  const centerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd34d,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  let helperCount = 0;
  const seenKeys = new Set<string>();
  const entries: CutoutDebugEntry[] = [];

  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    const mesh = node;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const cutout = resolveCutoutForMaterial(
        profile,
        mesh.name ?? "",
        material.name ?? "",
      );
      if (!cutout) {
        continue;
      }

      const dedupeKey = [
        mesh.uuid,
        cutout.matcher,
        cutout.center.join(","),
        cutout.radii.join(","),
      ].join("|");
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      seenKeys.add(dedupeKey);

      const bounds = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 12),
        helperMaterial.clone(),
      );
      bounds.name = `cutout-debug-${helperCount}`;
      bounds.position.set(cutout.center[0], cutout.center[1], cutout.center[2]);
      bounds.scale.set(cutout.radii[0], cutout.radii[1], cutout.radii[2]);
      bounds.renderOrder = 9998;
      mesh.add(bounds);

      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 10, 10),
        centerMaterial.clone(),
      );
      center.position.set(cutout.center[0], cutout.center[1], cutout.center[2]);
      center.renderOrder = 9999;
      mesh.add(center);
      entries.push({
        mesh,
        cutout,
        boundsHelper: bounds,
        centerHelper: center,
      });

      helperCount += 1;
    }
  });

  console.info(`Cutout debug helpers attached: ${helperCount}`);
  return entries;
}

/**
 * Resolves primary cutout alignment data in anchor-local/model-local space.
 *
 * This offset is later used to place the anchor so the cutout center itself,
 * not the model origin, aligns to the detected face point. It also returns
 * the cutout window width so face scale can be computed from eye spacing.
 *
 * @param anchor - Root tracking anchor that owns the model
 * @param model - Loaded GLB scene root
 * @param profile - Active profile containing cutout entries
 * @returns Primary cutout anchor data, or null when no cutout matches
 */
function resolvePrimaryCutoutAnchor(
  anchor: THREE.Object3D,
  model: THREE.Object3D,
  profile: FilterMaterialProfile,
): PrimaryCutoutAnchor | null {
  model.updateMatrixWorld(true);
  let resolvedAnchor: PrimaryCutoutAnchor | null = null;
  model.traverse((node) => {
    if (resolvedAnchor || !(node instanceof THREE.Mesh)) {
      return;
    }
    const mesh = node;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const cutout = resolveCutoutForMaterial(
        profile,
        mesh.name ?? "",
        material.name ?? "",
      );
      if (!cutout || !cutout.enabled) {
        continue;
      }
      const worldPoint = mesh.localToWorld(
        new THREE.Vector3(...cutout.center),
      );
      resolvedAnchor = {
        offset: anchor.worldToLocal(worldPoint.clone()),
        windowWidth: cutout.radii[0] * 2,
      };
      break;
    }
  });
  return resolvedAnchor;
}

/**
 * Builds an interactive panel for cutout tuning and copy/export workflow.
 *
 * @param entry - Selected cutout debug target
 * @param onUpdate - Called whenever cutout values are changed in UI
 */
function setupCutoutDebugPanel(
  entry: CutoutDebugEntry,
  debugState: FilterCutoutDebugState,
  onUpdate: () => void,
  onDebugStateUpdate: () => void,
): void {
  const panel = document.createElement("div");
  panel.id = "cutout-debug-panel";
  panel.innerHTML = `
    <div class="title">Cutout Tuner</div>
    <div class="row"><span>Matcher</span><code id="cutout-matcher"></code></div>
    <div class="row"><span>Center</span><code id="cutout-center"></code></div>
    <div class="row"><span>Radii</span><code id="cutout-radii"></code></div>
    <div class="row"><span>Feather</span><code id="cutout-feather"></code></div>
    <label class="toggle"><input id="cutout-visualize" type="checkbox"> Show shader occlusion tint</label>
    <label class="toggle"><input id="cutout-translucent" type="checkbox"> Translucent suit in tuning mode</label>
    <div class="sliders">
      <label>Suit A <input id="cutout-suit-opacity" type="range" min="0.05" max="0.9" step="0.01"></label>
      <label>Radius X <input id="cutout-rx" type="range" min="0.03" max="0.6" step="0.005"></label>
      <label>Radius Y <input id="cutout-ry" type="range" min="0.03" max="0.6" step="0.005"></label>
      <label>Radius Z <input id="cutout-rz" type="range" min="0.03" max="0.6" step="0.005"></label>
      <label>Feather <input id="cutout-feather-slider" type="range" min="0.01" max="0.5" step="0.01"></label>
    </div>
    <div class="actions">
      <button id="cutout-copy">Copy JSON</button>
    </div>
    <div class="hint">Drag yellow center dot to snap on mesh.</div>
  `;
  document.body.appendChild(panel);

  const matcherText = panel.querySelector<HTMLElement>("#cutout-matcher");
  const centerText = panel.querySelector<HTMLElement>("#cutout-center");
  const radiiText = panel.querySelector<HTMLElement>("#cutout-radii");
  const featherText = panel.querySelector<HTMLElement>("#cutout-feather");
  const radiusXInput = panel.querySelector<HTMLInputElement>("#cutout-rx");
  const radiusYInput = panel.querySelector<HTMLInputElement>("#cutout-ry");
  const radiusZInput = panel.querySelector<HTMLInputElement>("#cutout-rz");
  const featherInput = panel.querySelector<HTMLInputElement>("#cutout-feather-slider");
  const visualizeInput = panel.querySelector<HTMLInputElement>("#cutout-visualize");
  const translucentInput = panel.querySelector<HTMLInputElement>("#cutout-translucent");
  const suitOpacityInput = panel.querySelector<HTMLInputElement>("#cutout-suit-opacity");
  const copyButton = panel.querySelector<HTMLButtonElement>("#cutout-copy");
  if (
    !matcherText ||
    !centerText ||
    !radiiText ||
    !featherText ||
    !radiusXInput ||
    !radiusYInput ||
    !radiusZInput ||
    !featherInput ||
    !visualizeInput ||
    !translucentInput ||
    !suitOpacityInput ||
    !copyButton
  ) {
    return;
  }

  const refresh = (): void => {
    matcherText.textContent = entry.cutout.matcher;
    centerText.textContent = `[${entry.cutout.center.map((v) => v.toFixed(3)).join(", ")}]`;
    radiiText.textContent = `[${entry.cutout.radii.map((v) => v.toFixed(3)).join(", ")}]`;
    featherText.textContent = entry.cutout.feather.toFixed(3);
    radiusXInput.value = entry.cutout.radii[0].toString();
    radiusYInput.value = entry.cutout.radii[1].toString();
    radiusZInput.value = entry.cutout.radii[2].toString();
    featherInput.value = entry.cutout.feather.toString();
    visualizeInput.checked = debugState.visualizeOcclusion;
    translucentInput.checked = debugState.translucentMeshOpacity > 0;
    suitOpacityInput.value = debugState.translucentMeshOpacity.toString();
  };
  const updateRadius = (index: 0 | 1 | 2, value: number): void => {
    entry.cutout.radii[index] = Math.max(0.01, value);
    onUpdate();
    refresh();
  };
  const updateFeather = (value: number): void => {
    entry.cutout.feather = Math.max(0.01, value);
    onUpdate();
    refresh();
  };
  radiusXInput.addEventListener("input", () => {
    updateRadius(0, Number(radiusXInput.value));
  });
  radiusYInput.addEventListener("input", () => {
    updateRadius(1, Number(radiusYInput.value));
  });
  radiusZInput.addEventListener("input", () => {
    updateRadius(2, Number(radiusZInput.value));
  });
  featherInput.addEventListener("input", () => {
    updateFeather(Number(featherInput.value));
  });
  visualizeInput.addEventListener("change", () => {
    debugState.visualizeOcclusion = visualizeInput.checked;
    onDebugStateUpdate();
    refresh();
  });
  translucentInput.addEventListener("change", () => {
    if (!translucentInput.checked) {
      debugState.translucentMeshOpacity = 0;
    } else {
      debugState.translucentMeshOpacity = Math.max(
        0.05,
        Number(suitOpacityInput.value),
      );
    }
    onDebugStateUpdate();
    refresh();
  });
  suitOpacityInput.addEventListener("input", () => {
    const value = Number(suitOpacityInput.value);
    debugState.translucentMeshOpacity = translucentInput.checked ? value : 0;
    onDebugStateUpdate();
    refresh();
  });
  copyButton.addEventListener("click", async () => {
    const snippet = JSON.stringify(
      {
        enabled: entry.cutout.enabled,
        matcher: entry.cutout.matcher,
        center: entry.cutout.center,
        radii: entry.cutout.radii,
        feather: entry.cutout.feather,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(snippet);
      copyButton.textContent = "Copied!";
      setTimeout(() => {
        copyButton.textContent = "Copy JSON";
      }, 900);
    } catch {
      copyButton.textContent = "Copy failed";
      setTimeout(() => {
        copyButton.textContent = "Copy JSON";
      }, 900);
    }
  });

  refresh();
}

/**
 * Enables drag-to-position tuning for the first cutout debug entry.
 *
 * Dragging snaps the cutout center to raycast hit points on the matched mesh
 * so the center remains attached to model geometry.
 *
 * @param canvas - Render canvas for pointer events
 * @param camera - Active camera for raycasting
 * @param entry - Debug cutout target to update
 * @param onUpdate - Called whenever cutout values change
 */
function enableCutoutDragging(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  entry: CutoutDebugEntry,
  onUpdate: () => void,
): void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragging = false;

  const updatePointer = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    pointer.set(x * 2 - 1, -(y * 2 - 1));
  };

  const tryDragUpdate = (event: PointerEvent): void => {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObject(entry.mesh, false);
    if (intersections.length === 0) {
      return;
    }
    const hitWorld = intersections[0].point.clone();
    const hitLocal = entry.mesh.worldToLocal(hitWorld);
    entry.cutout.center = [hitLocal.x, hitLocal.y, hitLocal.z];
    onUpdate();
  };

  canvas.addEventListener("pointerdown", (event) => {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const intersectsCenter = raycaster.intersectObject(entry.centerHelper, false);
    if (intersectsCenter.length === 0) {
      return;
    }
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    tryDragUpdate(event);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }
    tryDragUpdate(event);
  });

  const finishDrag = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
}

/**
 * Logs mesh/material names from the loaded GLB for selector authoring.
 *
 * Use this output to build precise matcher terms for `filterTarget` and for
 * default override entries in the material profile artifact.
 *
 * @param model - Loaded GLB scene root to inspect
 */
function dumpModelMeshCatalog(model: THREE.Object3D): void {
  const rows: Array<{
    meshName: string;
    materialNames: string;
    vertexCount: number;
    boundsMin: [number, number, number];
    boundsMax: [number, number, number];
    boundsCenter: [number, number, number];
  }> = [];
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }

    const materialNames = Array.isArray(node.material)
      ? node.material.map((material) => material.name || "<unnamed>").join(", ")
      : node.material.name || "<unnamed>";
    node.geometry.computeBoundingBox();
    const bounds = node.geometry.boundingBox;
    const min: [number, number, number] = bounds
      ? [bounds.min.x, bounds.min.y, bounds.min.z]
      : [0, 0, 0];
    const max: [number, number, number] = bounds
      ? [bounds.max.x, bounds.max.y, bounds.max.z]
      : [0, 0, 0];
    const center: [number, number, number] = bounds
      ? [
          (bounds.min.x + bounds.max.x) * 0.5,
          (bounds.min.y + bounds.max.y) * 0.5,
          (bounds.min.z + bounds.max.z) * 0.5,
        ]
      : [0, 0, 0];
    rows.push({
      meshName: node.name || "<unnamed>",
      materialNames,
      vertexCount: node.geometry.attributes.position?.count ?? 0,
      boundsMin: min,
      boundsMax: max,
      boundsCenter: center,
    });
  });

  // Grouped table makes it easier to discover stable selector terms.
  console.group("Filter mesh catalog");
  console.log(JSON.stringify(rows, null, 2));
  console.groupEnd();
}

/**
 * Creates debug UI elements used to visualize pose landmarks and anchor data.
 *
 * @returns Debug overlay elements, or null when debug mode is disabled
 */
function setupDebugOverlay(): DebugOverlay | null {
  if (!DEBUG_ENABLED) {
    return null;
  }

  const debugCanvas = document.createElement("canvas");
  debugCanvas.id = "debug-overlay";
  document.body.appendChild(debugCanvas);

  const status = document.createElement("div");
  status.id = "debug-status";
  document.body.appendChild(status);

  const context = debugCanvas.getContext("2d");
  if (!context) {
    return null;
  }

  return { canvas: debugCanvas, context, status };
}

type DebugRenderToggles = {
  showAnchor: boolean;
  showFaceShaderHandle: boolean;
  showFaceShader: boolean;
};

/**
 * Creates a compact debug controls panel for runtime visualization toggles.
 *
 * @param initialToggles - Initial state used to populate checkbox values
 * @param onTogglesChanged - Invoked whenever any toggle value changes
 * @returns Mutable toggles state, or null when debug mode is disabled
 */
function setupDebugControls(
  initialToggles: DebugRenderToggles,
  onTogglesChanged: (toggles: DebugRenderToggles) => void,
): DebugRenderToggles | null {
  if (!DEBUG_ENABLED) {
    return null;
  }

  const panel = document.createElement("div");
  panel.id = "debug-controls-panel";
  panel.innerHTML = `
    <div class="title">Debug Controls</div>
    <label class="toggle"><input id="debug-toggle-anchor" type="checkbox"> Show anchor</label>
    <label class="toggle"><input id="debug-toggle-face-shader-handle" type="checkbox"> Show face shader handle</label>
    <label class="toggle"><input id="debug-toggle-face-shader" type="checkbox"> Enable face shader</label>
  `;
  document.body.appendChild(panel);

  const anchorInput = panel.querySelector<HTMLInputElement>("#debug-toggle-anchor");
  const handleInput = panel.querySelector<HTMLInputElement>(
    "#debug-toggle-face-shader-handle",
  );
  const shaderInput = panel.querySelector<HTMLInputElement>(
    "#debug-toggle-face-shader",
  );
  if (!anchorInput || !handleInput || !shaderInput) {
    return null;
  }

  const toggles: DebugRenderToggles = { ...initialToggles };
  const refresh = (): void => {
    anchorInput.checked = toggles.showAnchor;
    handleInput.checked = toggles.showFaceShaderHandle;
    shaderInput.checked = toggles.showFaceShader;
  };
  const emit = (): void => {
    onTogglesChanged({ ...toggles });
  };

  anchorInput.addEventListener("change", () => {
    toggles.showAnchor = anchorInput.checked;
    emit();
    refresh();
  });
  handleInput.addEventListener("change", () => {
    toggles.showFaceShaderHandle = handleInput.checked;
    emit();
    refresh();
  });
  shaderInput.addEventListener("change", () => {
    toggles.showFaceShader = shaderInput.checked;
    emit();
    refresh();
  });

  refresh();
  return toggles;
}

/**
 * Draws a labeled landmark marker in screen space for debug visualization.
 *
 * @param ctx - Canvas context for drawing
 * @param width - Overlay width in pixels
 * @param height - Overlay height in pixels
 * @param landmark - Normalized landmark to draw
 * @param color - Marker color
 * @param label - Text label rendered near the marker
 */
function drawDebugPoint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  landmark: PoseLandmark,
  color: string,
  label: string,
): void {
  const x = landmark.x * width;
  const y = landmark.y * height;
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = "12px monospace";
  ctx.fillStyle = "white";
  ctx.fillText(label, x + 8, y - 8);
}

/**
 * Draws debug overlays for pose landmarks and current anchor state.
 *
 * @param debugOverlay - Active overlay elements
 * @param width - Current viewport width
 * @param height - Current viewport height
 * @param torsoAnchor - Computed torso anchor data for the current frame
 * @param anchorVisible - Whether the rendered 3D anchor is currently visible
 * @param sourceMode - Current tracking source mode
 */
function renderDebugOverlay(
  debugOverlay: DebugOverlay,
  width: number,
  height: number,
  torsoAnchor: TorsoAnchor | null,
  faceAnchor: FaceAnchor | null,
  anchorVisible: boolean,
  sourceMode: TrackingSource["mode"],
  showDebugPoints: boolean,
  projectionContext?: ProjectionContext,
): void {
  const { canvas, context, status } = debugOverlay;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.clearRect(0, 0, width, height);
  if (!torsoAnchor) {
    const faceStatus = faceAnchor
      ? ` | face=ok | faceEye=${faceAnchor.eyeDistance.toFixed(3)} | faceScale=${faceAnchor.scale.toFixed(2)}`
      : " | face=none";
    status.textContent =
      `debug=1 | source=${sourceMode} | pose=none${faceStatus} | anchorVisible=${anchorVisible}`;
    return;
  }

  const {
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    shoulderCenter,
    hipCenter,
    chestCenter,
    hipsReliable,
  } = torsoAnchor.debug;
  const projectPoseDebugPoint = (
    landmark: PoseLandmark,
  ): PoseLandmark => {
    if (sourceMode !== "sample" || !projectionContext) {
      return landmark;
    }
    const point = viewportNormalizedFromLandmarkContained(
      landmark,
      projectionContext,
    );
    return { ...landmark, x: point.x, y: point.y };
  };
  if (showDebugPoints) {
    drawDebugPoint(
      context,
      width,
      height,
      projectPoseDebugPoint(leftShoulder),
      "#33d1ff",
      "L shoulder",
    );
    drawDebugPoint(
      context,
      width,
      height,
      projectPoseDebugPoint(rightShoulder),
      "#33d1ff",
      "R shoulder",
    );
    drawDebugPoint(
      context,
      width,
      height,
      projectPoseDebugPoint(shoulderCenter),
      "#f8dc53",
      "Shoulder C",
    );
    drawDebugPoint(
      context,
      width,
      height,
      projectPoseDebugPoint(hipCenter),
      "#ff9b53",
      "Hip C",
    );
    drawDebugPoint(
      context,
      width,
      height,
      projectPoseDebugPoint(chestCenter),
      "#7cff74",
      "Chest C",
    );
    if (leftHip) {
      drawDebugPoint(
        context,
        width,
        height,
        projectPoseDebugPoint(leftHip),
        "#ff6b6b",
        "L hip",
      );
    }
    if (rightHip) {
      drawDebugPoint(
        context,
        width,
        height,
        projectPoseDebugPoint(rightHip),
        "#ff6b6b",
        "R hip",
      );
    }
    if (faceAnchor) {
      drawDebugPoint(
        context,
        width,
        height,
        faceAnchor.debug.leftEye,
        "#57b8ff",
        "L eye",
      );
      drawDebugPoint(
        context,
        width,
        height,
        faceAnchor.debug.rightEye,
        "#57b8ff",
        "R eye",
      );
      drawDebugPoint(
        context,
        width,
        height,
        faceAnchor.debug.noseTip,
        "#9cff70",
        "Nose",
      );
      drawDebugPoint(
        context,
        width,
        height,
        faceAnchor.debug.anchorPoint,
        "#ffd84a",
        "Face A",
      );
    }
  }

  status.textContent =
    `debug=1 | source=${sourceMode} | pose=ok | hipsReliable=${hipsReliable} | ` +
    `ndc=(${torsoAnchor.ndcX.toFixed(2)}, ${torsoAnchor.ndcY.toFixed(2)}) | ` +
    `scale=${torsoAnchor.scale.toFixed(2)} | ` +
    `faceScale=${faceAnchor?.scale.toFixed(2) ?? "n/a"} | ` +
    `anchorVisible=${anchorVisible}`;
}

/**
 * Builds torso anchor transform data from shoulder and hip landmarks.
 *
 * Uses shoulder midpoint for horizontal placement and blends toward hips for
 * chest placement. Scale is estimated from both shoulder width and torso
 * length to produce steadier body-sized overlays.
 * 
 * Falls back to a synthetic hip center when hips are out of frame, so upper-
 * torso-only framing still produces stable body anchoring.
 *
 * @param result - PoseLandmarker detection result for the current frame
 * @param options - Mode-specific projection and scaling options
 * @returns Torso transform data, or null when shoulder landmarks are missing
 */
function torsoAnchorFromPose(
  result: PoseLandmarkerResult,
  options: TorsoAnchorOptions,
): TorsoAnchor | null {
  const landmarks = result.landmarks?.[0];
  if (!landmarks) {
    return null;
  }

  const leftShoulder = landmarks[LM_LEFT_SHOULDER] as PoseLandmark | undefined;
  const rightShoulder = landmarks[LM_RIGHT_SHOULDER] as
    | PoseLandmark
    | undefined;
  const leftHip = landmarks[LM_LEFT_HIP] as PoseLandmark | undefined;
  const rightHip = landmarks[LM_RIGHT_HIP] as PoseLandmark | undefined;

  if (!isReliableLandmark(leftShoulder) || !isReliableLandmark(rightShoulder)) {
    return null;
  }

  const shoulderCenter = {
    x: (leftShoulder.x + rightShoulder.x) * 0.5,
    y: (leftShoulder.y + rightShoulder.y) * 0.5,
    z: (leftShoulder.z + rightShoulder.z) * 0.5,
  };
  const shouldersReliable = [leftShoulder, rightShoulder].map(
    landmarkConfidence,
  );
  const hipsReliable =
    isReliableLandmark(leftHip) && isReliableLandmark(rightHip);
  const hipCenter = hipsReliable
    ? {
        x: (leftHip.x + rightHip.x) * 0.5,
        y: (leftHip.y + rightHip.y) * 0.5,
        z: (leftHip.z + rightHip.z) * 0.5,
      }
    : {
        x: shoulderCenter.x,
        y: shoulderCenter.y + SYNTHETIC_TORSO_LENGTH_FROM_SHOULDERS,
        z: shoulderCenter.z,
      };

  const chestCenter = {
    x: THREE.MathUtils.lerp(shoulderCenter.x, hipCenter.x, 0.35),
    y: THREE.MathUtils.lerp(shoulderCenter.y, hipCenter.y, 0.35),
  };
  const { x: ndcX, y: ndcY } = options.projectionContext
    ? ndcFromLandmarkContained(chestCenter, options.projectionContext)
    : ndcFromLandmark(chestCenter);

  const shoulderWidth = landmarkDistanceForScale(
    leftShoulder,
    rightShoulder,
    options.projectionContext,
  );
  const torsoLength = landmarkDistanceForScale(
    shoulderCenter,
    hipCenter,
    options.projectionContext,
  );
  const torsoWeight = hipsReliable ? 0.8 : 0.35;
  const combinedTorsoSize = shoulderWidth * 1.8 + torsoLength * torsoWeight;
  const scaleMultiplier = options.isSampleMode
    ? SAMPLE_SCALE_MULTIPLIER
    : CAMERA_SCALE_MULTIPLIER;
  const scaleMin = options.isSampleMode ? SAMPLE_SCALE_MIN : CAMERA_SCALE_MIN;
  const scaleMax = options.isSampleMode ? SAMPLE_SCALE_MAX : CAMERA_SCALE_MAX;
  const scale = THREE.MathUtils.clamp(
    combinedTorsoSize * scaleMultiplier,
    scaleMin,
    scaleMax,
  );

  const shoulderVector = new THREE.Vector2(
    rightShoulder.x - leftShoulder.x,
    rightShoulder.y - leftShoulder.y,
  );
  const roll = Math.atan2(shoulderVector.y, shoulderVector.x);
  const yaw = 0;
  const pitch = 0;
  const shoulderRoll = THREE.MathUtils.clamp(
    roll * BODY_ROLL_FROM_SHOULDERS,
    -0.25,
    0.25,
  );

  const rotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pitch, yaw, -shoulderRoll),
  );

  const shoulderConfidence = Math.min(...shouldersReliable);
  const confidenceScale = THREE.MathUtils.mapLinear(
    shoulderConfidence,
    BODY_MIN_VISIBILITY,
    1,
    0.9,
    1,
  );
  return {
    ndcX,
    ndcY,
    scale: scale * confidenceScale,
    shoulderWidth,
    rotation,
    debug: {
      leftShoulder,
      rightShoulder,
      leftHip: hipsReliable ? leftHip : undefined,
      rightHip: hipsReliable ? rightHip : undefined,
      shoulderCenter,
      hipCenter,
      chestCenter: { ...chestCenter, z: shoulderCenter.z },
      hipsReliable,
    },
  };
}

/**
 * Builds a face anchor from eye and nose landmarks.
 *
 * The anchor position is derived from the eye midpoint blended toward the nose,
 * which stabilizes horizontal alignment while keeping the cutout centered on the
 * front-face region. Scale is estimated from inter-eye distance so face opening
 * size better follows real face size changes.
 *
 * @param result - FaceLandmarker detection result for the current frame
 * @param options - Mode-specific projection and scaling options
 * @returns Face anchor data, or null when required landmarks are unavailable
 */
function faceAnchorFromFace(
  result: FaceLandmarkerResult,
  options: TorsoAnchorOptions,
): FaceAnchor | null {
  const face = result.faceLandmarks[0];
  if (!face) {
    return null;
  }
  const leftEye = face[FM_LEFT_EYE_OUTER];
  const rightEye = face[FM_RIGHT_EYE_OUTER];
  const noseTip = face[FM_NOSE_TIP];
  if (!leftEye || !rightEye || !noseTip) {
    return null;
  }

  const screenLeftEye = leftEye.x <= rightEye.x ? leftEye : rightEye;
  const screenRightEye = leftEye.x <= rightEye.x ? rightEye : leftEye;
  const eyeMid = {
    x: (screenLeftEye.x + screenRightEye.x) * 0.5,
    y: (screenLeftEye.y + screenRightEye.y) * 0.5,
  };
  const eyeDistance = landmarkDistanceForScale(
    screenRightEye,
    screenLeftEye,
    options.projectionContext,
  );
  if (eyeDistance < MIN_FACE_EYE_DISTANCE) {
    return null;
  }

  const anchorPoint = {
    x: THREE.MathUtils.lerp(eyeMid.x, noseTip.x, FACE_ANCHOR_EYE_NOSE_BLEND_X),
    y: THREE.MathUtils.lerp(eyeMid.y, noseTip.y, FACE_ANCHOR_EYE_NOSE_BLEND_Y),
  };
  const leftEyeNdc = options.projectionContext
    ? ndcFromLandmarkContained(screenLeftEye, options.projectionContext)
    : ndcFromLandmark(screenLeftEye);
  const rightEyeNdc = options.projectionContext
    ? ndcFromLandmarkContained(screenRightEye, options.projectionContext)
    : ndcFromLandmark(screenRightEye);
  const { x: ndcX, y: ndcY } = options.projectionContext
    ? ndcFromLandmarkContained(anchorPoint, options.projectionContext)
    : ndcFromLandmark(anchorPoint);
  const scale = THREE.MathUtils.clamp(
    eyeDistance * FACE_SCALE_MULTIPLIER,
    FACE_SCALE_MIN,
    FACE_SCALE_MAX,
  );
  const debugLeftEye = options.projectionContext
    ? viewportNormalizedFromLandmarkContained(
        screenLeftEye,
        options.projectionContext,
      )
    : { x: screenLeftEye.x, y: screenLeftEye.y };
  const debugRightEye = options.projectionContext
    ? viewportNormalizedFromLandmarkContained(
        screenRightEye,
        options.projectionContext,
      )
    : { x: screenRightEye.x, y: screenRightEye.y };
  const debugNoseTip = options.projectionContext
    ? viewportNormalizedFromLandmarkContained(noseTip, options.projectionContext)
    : { x: noseTip.x, y: noseTip.y };
  const debugAnchorPoint = options.projectionContext
    ? viewportNormalizedFromLandmarkContained(
        anchorPoint,
        options.projectionContext,
      )
    : { x: anchorPoint.x, y: anchorPoint.y };

  return {
    ndcX,
    ndcY,
    scale,
    eyeDistance,
    eyeDeltaNdcX: rightEyeNdc.x - leftEyeNdc.x,
    eyeDeltaNdcY: rightEyeNdc.y - leftEyeNdc.y,
    debug: {
      leftEye: { x: debugLeftEye.x, y: debugLeftEye.y, z: screenLeftEye.z ?? 0 },
      rightEye: {
        x: debugRightEye.x,
        y: debugRightEye.y,
        z: screenRightEye.z ?? 0,
      },
      noseTip: { x: debugNoseTip.x, y: debugNoseTip.y, z: noseTip.z ?? 0 },
      anchorPoint: { x: debugAnchorPoint.x, y: debugAnchorPoint.y, z: 0 },
    },
  };
}

/**
 * Extracts head yaw, pitch, and roll from face landmarks.
 *
 * Uses eye-line tilt for roll, nose X offset for yaw, and nose Y offset from
 * the eye midpoint for pitch. Returns null when the face landmarks are
 * unavailable or too compressed.
 *
 * @param result - FaceLandmarker detection result for the current frame
 * @returns Head yaw/pitch/roll angles in radians, or null when unavailable
 */
function headRotationFromFace(result: FaceLandmarkerResult): {
  yaw: number;
  pitch: number;
  roll: number;
} | null {
  const face = result.faceLandmarks[0];
  if (!face) {
    return null;
  }
  const leftEye = face[FM_LEFT_EYE_OUTER];
  const rightEye = face[FM_RIGHT_EYE_OUTER];
  const noseTip = face[FM_NOSE_TIP];
  if (!leftEye || !rightEye || !noseTip) {
    return null;
  }

  const screenLeftEye = leftEye.x <= rightEye.x ? leftEye : rightEye;
  const screenRightEye = leftEye.x <= rightEye.x ? rightEye : leftEye;
  const eyeDx = screenRightEye.x - screenLeftEye.x;
  const eyeDy = screenRightEye.y - screenLeftEye.y;
  const eyeDistance = Math.hypot(eyeDx, eyeDy);
  if (eyeDistance < MIN_FACE_EYE_DISTANCE) {
    return null;
  }

  const eyeMidX = (screenLeftEye.x + screenRightEye.x) * 0.5;
  const eyeMidY = (screenLeftEye.y + screenRightEye.y) * 0.5;
  const roll = THREE.MathUtils.clamp(Math.atan2(eyeDy, eyeDx), -0.9, 0.9);
  const yaw = THREE.MathUtils.clamp(
    ((noseTip.x - eyeMidX) / eyeDistance) * HEAD_YAW_FROM_NOSE_OFFSET,
    -0.95,
    0.95,
  );
  const noseEyeVerticalRatio = (noseTip.y - eyeMidY) / eyeDistance;
  const pitch = THREE.MathUtils.clamp(
    (noseEyeVerticalRatio - HEAD_PITCH_NEUTRAL_NOSE_EYE_RATIO) *
      HEAD_PITCH_FROM_NOSE_OFFSET,
    -0.85,
    0.85,
  );

  return { yaw, pitch, roll };
}

/**
 * Blends torso and head rotations for cutout-aware suit orientation.
 *
 * Blends torso yaw/pitch/roll toward head-derived values with clamping so body
 * alignment remains stable while the face opening follows head direction.
 *
 * @param torsoRotation - Rotation derived from torso pose landmarks
 * @param headRotation - Optional head yaw/roll from face landmarks
 * @returns Rotation quaternion used by the rendered suit anchor
 */
function blendAnchorRotation(
  torsoRotation: THREE.Quaternion,
  headRotation: { yaw: number; pitch: number; roll: number } | null,
): THREE.Quaternion {
  if (!headRotation) {
    return torsoRotation.clone();
  }

  const torsoEuler = new THREE.Euler().setFromQuaternion(torsoRotation, "XYZ");
  const clampedHeadYaw = THREE.MathUtils.clamp(
    headRotation.yaw,
    torsoEuler.y - HEAD_MAX_YAW_DELTA_FROM_TORSO,
    torsoEuler.y + HEAD_MAX_YAW_DELTA_FROM_TORSO,
  );
  const blendedYaw = THREE.MathUtils.lerp(
    torsoEuler.y,
    clampedHeadYaw,
    HEAD_YAW_BLEND_WEIGHT,
  );
  const clampedHeadPitch = THREE.MathUtils.clamp(
    headRotation.pitch,
    torsoEuler.x - HEAD_MAX_PITCH_DELTA_FROM_TORSO,
    torsoEuler.x + HEAD_MAX_PITCH_DELTA_FROM_TORSO,
  );
  const blendedPitch = THREE.MathUtils.lerp(
    torsoEuler.x,
    clampedHeadPitch,
    HEAD_PITCH_BLEND_WEIGHT,
  );
  // Add gentle yaw-to-roll coupling so left/right face turns visibly tilt the suit.
  const desiredHeadRoll =
    headRotation.roll * HEAD_ROLL_SIGN + clampedHeadYaw * HEAD_ROLL_FROM_YAW;
  const clampedHeadRoll = THREE.MathUtils.clamp(
    desiredHeadRoll,
    torsoEuler.z - HEAD_MAX_ROLL_DELTA_FROM_TORSO,
    torsoEuler.z + HEAD_MAX_ROLL_DELTA_FROM_TORSO,
  );
  const blendedRoll = THREE.MathUtils.lerp(
    torsoEuler.z,
    clampedHeadRoll,
    HEAD_ROLL_BLEND_WEIGHT,
  );

  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(blendedPitch, blendedYaw, blendedRoll),
  );
}

/**
 * Initializes tracking and render loop for the lobster face filter overlay.
 *
 * @returns A promise that resolves when initial setup is complete
 */
async function main(): Promise<void> {
  const video = document.querySelector<HTMLVideoElement>("#video");
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  if (!video || !canvas) {
    throw new Error("Expected #video and #canvas elements in index.html.");
  }

  const trackingSource = await setupTrackingSource(video);
  const poseLandmarker = await setupPoseLandmarker(
    trackingSource.mode === "camera" ? "VIDEO" : "IMAGE",
  );
  const faceLandmarker = await setupFaceLandmarker(
    trackingSource.mode === "camera" ? "VIDEO" : "IMAGE",
  );
  const queryParams = new URLSearchParams(window.location.search);
  const filterArtifact = await loadProfileArtifact(MODEL_OVERRIDES_URL);
  const mergedFilterProfile = mergeProfileArtifact(
    DEFAULT_FILTER_MATERIAL_PROFILE,
    filterArtifact,
  );
  const filterMaterialProfile = profileFromQueryParams(
    window.location.search,
    mergedFilterProfile,
  );

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
  });
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  camera.position.set(0, 0, 3);

  const light = new THREE.DirectionalLight(0xffffff, 1.25);
  light.position.set(1, 2, 3);
  scene.add(light, new THREE.AmbientLight(0xffffff, 0.6));

  const anchor = new THREE.Group();
  scene.add(anchor);
  const debugOverlay = setupDebugOverlay();
  const debugMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0x00ff99, wireframe: true }),
  );
  debugMarker.visible = DEBUG_ENABLED;
  scene.add(debugMarker);
  const debugRenderToggles: DebugRenderToggles = {
    showAnchor: true,
    showFaceShaderHandle: true,
    showFaceShader: queryParams.get("filterDebugFaceShader") !== "0",
  };

  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const model = gltf.scene;
  if (queryParams.get("filterDumpMeshes") === "1") {
    dumpModelMeshCatalog(model);
  }
  const showCutoutDebug =
    queryParams.get("filterDebugCutout") === "1" ||
    (DEBUG_ENABLED && queryParams.get("filterDebugCutout") !== "0");
  const cutoutDebugState: FilterCutoutDebugState | undefined = showCutoutDebug
    ? {
        visualizeOcclusion:
          queryParams.get("filterDebugOcclusion") !== "0",
        shaderEnabled: debugRenderToggles.showFaceShader,
        translucentMeshOpacity: THREE.MathUtils.clamp(
          Number(queryParams.get("filterDebugSuitOpacity") ?? "0.35") || 0.35,
          0.05,
          0.9,
        ),
      }
    : undefined;
  applyFilterMaterialProfileToModel(model, filterMaterialProfile, cutoutDebugState);
  const cutoutDebugEntries: CutoutDebugEntry[] = [];
  if (showCutoutDebug) {
    cutoutDebugEntries.push(...addCutoutDebugHelpers(model, filterMaterialProfile));
  }
  let centeredOffsetX = BODY_OFFSET_X;
  if (BODY_AUTO_CENTER_X) {
    const modelBounds = new THREE.Box3().setFromObject(model);
    const modelCenter = new THREE.Vector3();
    modelBounds.getCenter(modelCenter);
    centeredOffsetX -= modelCenter.x;
  }
  anchor.add(model);
  model.position.set(centeredOffsetX, BODY_OFFSET_Y, BODY_OFFSET_Z);
  model.rotation.set(
    BODY_ROTATION_OFFSET_X,
    BODY_ROTATION_OFFSET_Y,
    BODY_ROTATION_OFFSET_Z,
  );
  model.scale.setScalar(BODY_SCALE_MULTIPLIER);
  scene.updateMatrixWorld(true);
  const primaryCutoutAnchor = resolvePrimaryCutoutAnchor(
    anchor,
    model,
    filterMaterialProfile,
  );
  const primaryCutoutAnchorOffset = primaryCutoutAnchor?.offset ?? null;
  const primaryCutoutWindowWidth = primaryCutoutAnchor?.windowWidth ?? null;

  const smoothedPos = new THREE.Vector3(0, 0, 0);
  const smoothedQuat = new THREE.Quaternion();
  let smoothedScale = 1;
  let smoothedFaceEyeDistance: number | null = null;
  let lastPoseSeenAt = Number.NEGATIVE_INFINITY;
  let hasSeenPose = false;
  anchor.visible = false;

  const syncCutoutDebugEntry = (entry: CutoutDebugEntry): void => {
    entry.boundsHelper.position.set(
      entry.cutout.center[0],
      entry.cutout.center[1],
      entry.cutout.center[2],
    );
    entry.boundsHelper.scale.set(
      entry.cutout.radii[0],
      entry.cutout.radii[1],
      entry.cutout.radii[2],
    );
    entry.centerHelper.position.set(
      entry.cutout.center[0],
      entry.cutout.center[1],
      entry.cutout.center[2],
    );
    const materials = Array.isArray(entry.mesh.material)
      ? entry.mesh.material
      : [entry.mesh.material];
    for (const material of materials) {
      updateCutoutMaterialState(material, entry.cutout);
    }
  };

  if (showCutoutDebug && cutoutDebugEntries.length > 0) {
    const selectedEntry = cutoutDebugEntries[0];
    const onCutoutUpdated = (): void => {
      syncCutoutDebugEntry(selectedEntry);
    };
    const onCutoutDebugStateUpdated = (): void => {
      if (!cutoutDebugState) {
        return;
      }
      const materials = Array.isArray(selectedEntry.mesh.material)
        ? selectedEntry.mesh.material
        : [selectedEntry.mesh.material];
      for (const material of materials) {
        updateCutoutDebugState(material, cutoutDebugState);
        material.transparent = true;
        material.depthWrite = false;
        const baseOpacity = (
          material.userData as { filterBaseOpacity?: number }
        ).filterBaseOpacity;
        const fallbackOpacity = baseOpacity ?? 1;
        material.opacity =
          cutoutDebugState.translucentMeshOpacity > 0
            ? Math.min(
                fallbackOpacity,
                cutoutDebugState.translucentMeshOpacity,
              )
            : fallbackOpacity;
      }
    };
    setupCutoutDebugPanel(
      selectedEntry,
      cutoutDebugState ?? {
        visualizeOcclusion: true,
        shaderEnabled: true,
        translucentMeshOpacity: 0.35,
      },
      onCutoutUpdated,
      onCutoutDebugStateUpdated,
    );
    enableCutoutDragging(canvas, camera, selectedEntry, onCutoutUpdated);
  }

  const syncFaceShaderToggle = (): void => {
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) {
        return;
      }
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of materials) {
        updateCutoutDebugState(material, {
          visualizeOcclusion: cutoutDebugState?.visualizeOcclusion ?? false,
          shaderEnabled: debugRenderToggles.showFaceShader,
          translucentMeshOpacity: cutoutDebugState?.translucentMeshOpacity ?? 0,
        });
      }
    });
  };
  const syncFaceShaderHandleToggle = (): void => {
    for (const entry of cutoutDebugEntries) {
      entry.boundsHelper.visible = debugRenderToggles.showFaceShaderHandle;
      entry.centerHelper.visible = debugRenderToggles.showFaceShaderHandle;
    }
  };
  syncFaceShaderToggle();
  syncFaceShaderHandleToggle();
  setupDebugControls(debugRenderToggles, (toggles) => {
    debugRenderToggles.showAnchor = toggles.showAnchor;
    debugRenderToggles.showFaceShaderHandle = toggles.showFaceShaderHandle;
    debugRenderToggles.showFaceShader = toggles.showFaceShader;
    if (cutoutDebugState) {
      cutoutDebugState.shaderEnabled = toggles.showFaceShader;
    }
    syncFaceShaderToggle();
    syncFaceShaderHandleToggle();
  });

  const tick = (): void => {
    const now = performance.now();
    const width = canvas.clientWidth | 0;
    const height = canvas.clientHeight | 0;
    if (canvas.width !== width || canvas.height !== height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    }

    const poseResult =
      trackingSource.mode === "camera"
        ? poseLandmarker.detectForVideo(trackingSource.frameSource, now)
        : poseLandmarker.detect(trackingSource.frameSource);
    const faceResult =
      trackingSource.mode === "camera"
        ? faceLandmarker.detectForVideo(trackingSource.frameSource, now)
        : faceLandmarker.detect(trackingSource.frameSource);

    const sourceWidth =
      trackingSource.mode === "camera"
        ? trackingSource.frameSource.videoWidth || width
        : trackingSource.frameSource.naturalWidth || width;
    const sourceHeight =
      trackingSource.mode === "camera"
        ? trackingSource.frameSource.videoHeight || height
        : trackingSource.frameSource.naturalHeight || height;
    const projectionContext =
      trackingSource.mode === "sample"
        ? {
            sourceWidth,
            sourceHeight,
            viewportWidth: Math.max(1, width),
            viewportHeight: Math.max(1, height),
          }
        : undefined;
    const isSampleMode = trackingSource.mode === "sample";

    const torsoAnchor = torsoAnchorFromPose(poseResult, {
      isSampleMode,
      projectionContext,
    });
    const faceAnchor = faceAnchorFromFace(faceResult, {
      isSampleMode,
      projectionContext,
    });
    const headRotation = headRotationFromFace(faceResult);
    if (faceAnchor) {
      if (smoothedFaceEyeDistance === null) {
        smoothedFaceEyeDistance = faceAnchor.eyeDistance;
      } else {
        const eyeDistanceBlend =
          faceAnchor.eyeDistance >= smoothedFaceEyeDistance
            ? FACE_EYE_DISTANCE_SMOOTH_UP
            : FACE_EYE_DISTANCE_SMOOTH_DOWN;
        smoothedFaceEyeDistance = THREE.MathUtils.lerp(
          smoothedFaceEyeDistance,
          faceAnchor.eyeDistance,
          eyeDistanceBlend,
        );
      }
    } else {
      smoothedFaceEyeDistance = null;
    }
    const effectiveFaceEyeDistance =
      smoothedFaceEyeDistance ?? faceAnchor?.eyeDistance ?? MIN_FACE_EYE_DISTANCE;
    const stabilizedFaceScale = faceAnchor
      ? THREE.MathUtils.clamp(
          effectiveFaceEyeDistance * FACE_SCALE_MULTIPLIER,
          FACE_SCALE_MIN,
          FACE_SCALE_MAX,
        )
      : null;
    const anchorPlaneDistance = Math.max(
      1e-4,
      camera.position.z - ANCHOR_WORLD_Z,
    );
    const anchorPlaneHeight =
      2 *
      Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) *
      anchorPlaneDistance;
    const anchorPlaneWidth = anchorPlaneHeight * camera.aspect;
    const geometryDrivenFaceScale =
      isSampleMode && faceAnchor && primaryCutoutWindowWidth
        ? (() => {
            const rawEyeNdcDistance = Math.hypot(
              faceAnchor.eyeDeltaNdcX,
              faceAnchor.eyeDeltaNdcY,
            );
            const smoothedToRawRatio =
              rawEyeNdcDistance > 1e-4
                ? effectiveFaceEyeDistance / rawEyeNdcDistance
                : 1;
            const stabilizedEyeDeltaNdcX =
              faceAnchor.eyeDeltaNdcX * smoothedToRawRatio;
            const stabilizedEyeDeltaNdcY =
              faceAnchor.eyeDeltaNdcY * smoothedToRawRatio;
            const eyeWorldDistance = Math.hypot(
              stabilizedEyeDeltaNdcX * (anchorPlaneWidth * 0.5),
              stabilizedEyeDeltaNdcY * (anchorPlaneHeight * 0.5),
            );
            return THREE.MathUtils.clamp(
              (eyeWorldDistance * FACE_WINDOW_WIDTH_FROM_EYE_DISTANCE) /
                Math.max(primaryCutoutWindowWidth, 1e-4),
              FACE_SCALE_MIN,
              FACE_SCALE_MAX,
            );
          })()
        : null;
    const resolvedFaceScale = geometryDrivenFaceScale ?? stabilizedFaceScale;
    if (torsoAnchor || faceAnchor) {
      const positionBlendWeight =
        isSampleMode
          ? FACE_ANCHOR_POSITION_BLEND_SAMPLE
          : FACE_ANCHOR_POSITION_BLEND_CAMERA;
      const scaleBlendWeight =
        isSampleMode
          ? FACE_ANCHOR_SCALE_BLEND_SAMPLE
          : FACE_ANCHOR_SCALE_BLEND_CAMERA;
      const blendedNdcX =
        isSampleMode && faceAnchor
          ? faceAnchor.ndcX
          : torsoAnchor && faceAnchor
          ? THREE.MathUtils.lerp(
              torsoAnchor.ndcX,
              faceAnchor.ndcX,
              positionBlendWeight,
            )
          : (faceAnchor?.ndcX ?? torsoAnchor!.ndcX);
      const blendedNdcY =
        isSampleMode && faceAnchor
          ? faceAnchor.ndcY
          : torsoAnchor && faceAnchor
          ? THREE.MathUtils.lerp(
              torsoAnchor.ndcY,
              faceAnchor.ndcY,
              positionBlendWeight,
            )
          : (faceAnchor?.ndcY ?? torsoAnchor!.ndcY);
      const blendedScale =
        torsoAnchor && faceAnchor
          ? Math.max(
              THREE.MathUtils.lerp(
                torsoAnchor.scale,
                resolvedFaceScale! *
                  THREE.MathUtils.mapLinear(
                    THREE.MathUtils.clamp(
                      effectiveFaceEyeDistance /
                        Math.max(torsoAnchor.shoulderWidth, 1e-4),
                      0.18,
                      0.55,
                    ),
                    0.18,
                    0.55,
                    0.9,
                    1.1,
                  ) *
                  FACE_SCALE_FIT_PADDING,
                scaleBlendWeight *
                  THREE.MathUtils.clamp(
                    THREE.MathUtils.mapLinear(
                      effectiveFaceEyeDistance,
                      MIN_FACE_EYE_DISTANCE,
                      0.16,
                      FACE_SCALE_DYNAMIC_BLEND_MIN,
                      FACE_SCALE_DYNAMIC_BLEND_MAX,
                    ),
                    FACE_SCALE_DYNAMIC_BLEND_MIN,
                    FACE_SCALE_DYNAMIC_BLEND_MAX,
                  ),
              ),
              torsoAnchor.scale * 0.95,
            )
          : torsoAnchor
            ? torsoAnchor.scale
            : resolvedFaceScale! * FACE_SCALE_FIT_PADDING;
      const sampleBaseScale = isSampleMode
        ? THREE.MathUtils.clamp(blendedScale, SAMPLE_SCALE_MIN, SAMPLE_SCALE_MAX)
        : blendedScale;
      const finalTargetScale = isSampleMode
        ? sampleBaseScale
        : blendedScale;
      const anchorRotation = torsoAnchor
        ? blendAnchorRotation(torsoAnchor.rotation, headRotation)
        : headRotation
          ? blendAnchorRotation(new THREE.Quaternion(), headRotation)
          : new THREE.Quaternion();
      const baseWorldPos = worldPointFromNdc(
        camera,
        blendedNdcX,
        blendedNdcY,
        ANCHOR_WORLD_Z,
      );
      let worldPos = baseWorldPos;
      if (faceAnchor && primaryCutoutAnchorOffset) {
        const faceWorldPos = worldPointFromNdc(
          camera,
          faceAnchor.ndcX,
          faceAnchor.ndcY,
          ANCHOR_WORLD_Z,
        );
        const cutoutOffsetWorld = primaryCutoutAnchorOffset
          .clone()
          .multiplyScalar(finalTargetScale)
          .applyQuaternion(anchorRotation);
        const cutoutCenteredAnchorPos = faceWorldPos.sub(cutoutOffsetWorld);
        const cutoutCenteringWeight = isSampleMode
          ? FACE_CUTOUT_CENTERING_WEIGHT_SAMPLE
          : FACE_CUTOUT_CENTERING_WEIGHT_CAMERA;
        worldPos = baseWorldPos.clone().lerp(
          cutoutCenteredAnchorPos,
          cutoutCenteringWeight,
        );
      }
      if (
        smoothedPos.distanceToSquared(worldPos) >
        BODY_POSITION_DEADBAND * BODY_POSITION_DEADBAND
      ) {
        smoothedPos.lerp(worldPos, 1 - BODY_POS_SMOOTH);
      }
      anchor.position.copy(smoothedPos);

      smoothedScale = THREE.MathUtils.lerp(
        smoothedScale,
        finalTargetScale,
        1 - BODY_SCALE_SMOOTH,
      );
      anchor.scale.setScalar(smoothedScale);

      if (smoothedQuat.angleTo(anchorRotation) > BODY_ROTATION_DEADBAND_RAD) {
        smoothedQuat.slerp(anchorRotation, 1 - BODY_ROT_SMOOTH);
      }
      anchor.quaternion.copy(smoothedQuat);
      if (DEBUG_ENABLED) {
        debugMarker.visible = debugRenderToggles.showAnchor;
        // Show the core blended anchor target (before cutout-centering shift)
        // so the marker stays centered relative to body/face tracking intent.
        debugMarker.position.copy(baseWorldPos);
      }
      anchor.visible = true;
      lastPoseSeenAt = now;
      hasSeenPose = true;
    } else {
      anchor.visible =
        hasSeenPose && now - lastPoseSeenAt <= POSE_LOST_HIDE_DELAY_MS;
      if (DEBUG_ENABLED) {
        debugMarker.visible = false;
      }
    }

    if (debugOverlay) {
      renderDebugOverlay(
        debugOverlay,
        width,
        height,
        torsoAnchor,
        faceAnchor,
        anchor.visible,
        trackingSource.mode,
        true,
        projectionContext,
      );
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);

  window.addEventListener("beforeunload", () => {
    trackingSource.release();
    poseLandmarker.close();
    faceLandmarker.close();
  });
}

main().catch((error: unknown) => {
  console.error("Failed to start lobster face filter demo:", error);
});
