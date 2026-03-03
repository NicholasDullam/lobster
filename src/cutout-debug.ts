import * as THREE from "three";
import {
  applyCutoutToMaterial,
  applyTuningToMaterial,
  resolveCutoutForMaterial,
  resolveFilterMaterialTuning,
  updateCutoutDebugState,
  updateCutoutMaterialState,
  type FilterCutoutDebugState,
  type FilterMaterialProfile,
} from "./filter-material-profile";
import type { CutoutDebugEntry, PrimaryCutoutAnchor } from "./tracking-types";

/**
 * Applies runtime material profile tuning to every mesh in the loaded model.
 *
 * Clones each material before mutation so edits remain local to this model
 * instance and do not leak into cached GLTF material references.
 *
 * @param model - Loaded GLTF scene root to traverse
 * @param profile - Active material tuning profile
 * @param cutoutDebugState - Optional debug state used to override opacity/flags
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
        // Preserve baseline opacity so tuning toggles can restore it exactly.
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
 * @returns Collection of helper entries for interactive tuning
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
      bounds.position.set(...cutout.center);
      bounds.scale.set(...cutout.radii);
      bounds.renderOrder = 9998;
      mesh.add(bounds);

      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 10, 10),
        centerMaterial.clone(),
      );
      center.position.set(...cutout.center);
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
 * @param debugState - Mutable debug state shared with shader/material updates
 * @param onUpdate - Called whenever cutout values are changed in UI
 * @param onDebugStateUpdate - Called whenever debug state toggles change
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
 * Syncs helper meshes and shader uniforms after cutout values change.
 *
 * @param entry - Cutout debug entry to refresh
 */
function syncCutoutDebugEntry(entry: CutoutDebugEntry): void {
  entry.boundsHelper.position.set(...entry.cutout.center);
  entry.boundsHelper.scale.set(...entry.cutout.radii);
  entry.centerHelper.position.set(...entry.cutout.center);
  const materials = Array.isArray(entry.mesh.material)
    ? entry.mesh.material
    : [entry.mesh.material];
  for (const material of materials) {
    updateCutoutMaterialState(material, entry.cutout);
  }
}

/**
 * Applies debug-state toggles to all materials in the selected cutout entry.
 *
 * @param entry - Cutout debug entry whose materials should be updated
 * @param debugState - Debug state that controls shader and translucency behavior
 */
function syncCutoutDebugStateToEntry(
  entry: CutoutDebugEntry,
  debugState: FilterCutoutDebugState,
): void {
  const materials = Array.isArray(entry.mesh.material)
    ? entry.mesh.material
    : [entry.mesh.material];
  for (const material of materials) {
    updateCutoutDebugState(material, debugState);
    material.transparent = true;
    material.depthWrite = false;
    const baseOpacity = (
      material.userData as { filterBaseOpacity?: number }
    ).filterBaseOpacity;
    const fallbackOpacity = baseOpacity ?? 1;
    material.opacity =
      debugState.translucentMeshOpacity > 0
        ? Math.min(fallbackOpacity, debugState.translucentMeshOpacity)
        : fallbackOpacity;
  }
}

export {
  addCutoutDebugHelpers,
  applyFilterMaterialProfileToModel,
  dumpModelMeshCatalog,
  enableCutoutDragging,
  resolvePrimaryCutoutAnchor,
  setupCutoutDebugPanel,
  syncCutoutDebugEntry,
  syncCutoutDebugStateToEntry,
};
