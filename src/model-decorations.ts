import * as THREE from "three";
import type { ModelConfig } from "./model-config";

export type DecorationState = {
  /**
   * Elapsed runtime in seconds for animated decoration effects.
   */
  elapsedSeconds: number;
  /**
   * Normalized [0, 1] amount describing how strongly the user is tilting upward.
   */
  upwardTiltAmount: number;
};

type DecorationUpdater = (state: DecorationState) => void;

/**
 * Attaches optional runtime decorations for the active model.
 *
 * Decorations and presentation effects are resolved from model bounds so
 * lightweight branding or visibility fixes can be added without modifying the
 * underlying GLB asset.
 *
 * @param model - Loaded GLTF scene root that receives decoration meshes
 * @param config - Active model configuration that may define decorations
 * @param bounds - Base model bounds computed before decorations are attached
 * @returns Animation callback for shader-driven decorations, or null when unused
 */
export function attachModelDecorations(
  model: THREE.Object3D,
  config: ModelConfig,
  bounds: THREE.Box3,
): DecorationUpdater | null {
  if (bounds.isEmpty()) {
    return null;
  }

  const updaters: DecorationUpdater[] = [];

  if (config.undersideTransparency) {
    const undersideUpdater = applyUndersideTransparency(model, config, bounds);
    if (undersideUpdater) {
      updaters.push(undersideUpdater);
    }
  }

  if (!config.frontText) {
    return updaters.length > 0
      ? (state: DecorationState): void => {
          updaters.forEach((updater) => updater(state));
        }
      : null;
  }

  const { frontText } = config;
  const textGeometry = createProjectedFrontTextGeometry(model, bounds, frontText);
  const texture = createFrontTextTexture(frontText.text, frontText.color);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
  const textMesh = new THREE.Mesh(textGeometry, material);
  textMesh.name = `${config.id}-front-text`;
  textMesh.renderOrder = 10000;
  model.add(textMesh);

  return (state: DecorationState): void => {
    updaters.forEach((updater) => updater(state));
  };
}

/**
 * Applies a local-bounds shader mask that hides the lower interior of a hat.
 *
 * The exemption band is kept opaque toward the front of the model so the bill
 * remains visible even though the rest of the underside is punched out.
 *
 * @param model - Loaded GLTF scene root that owns the hat materials
 * @param config - Active model configuration containing underside settings
 * @param bounds - Base model bounds used to normalize local positions
 */
function applyUndersideTransparency(
  model: THREE.Object3D,
  config: ModelConfig,
  bounds: THREE.Box3,
): DecorationUpdater | null {
  if (!config.undersideTransparency) {
    return null;
  }

  const boundsMin = bounds.min.clone();
  const boundsSize = bounds.getSize(new THREE.Vector3()).max(
    new THREE.Vector3(1e-4, 1e-4, 1e-4),
  );
  const {
    yThresholdNormalized,
    billStartNormalized,
    frontExemptionHalfWidthNormalized,
    ornamentExemptionNormalized,
    feather,
    tiltStartRadians,
    tiltFullRadians,
  } = config.undersideTransparency;
  const ornamentCenter = ornamentExemptionNormalized
    ? new THREE.Vector2(
        ornamentExemptionNormalized.center.x,
        ornamentExemptionNormalized.center.y,
      )
    : null;
  const ornamentDepthStart = ornamentExemptionNormalized
    ? ornamentExemptionNormalized.depthStartNormalized
    : null;
  const ornamentHalfSize = ornamentExemptionNormalized
    ? new THREE.Vector2(
        ornamentExemptionNormalized.size.width * 0.5,
        ornamentExemptionNormalized.size.height * 0.5,
      )
    : null;
  const tiltUniforms: Array<THREE.IUniform<number>> = [];

  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }

    const applyMaterialMask = (material: THREE.Material): void => {
      if ((material.userData as { undersideTransparencyApplied?: boolean })
        .undersideTransparencyApplied) {
        return;
      }

      const previousOnBeforeCompile = material.onBeforeCompile;
      const previousProgramCacheKey = material.customProgramCacheKey?.bind(material);
      material.transparent = true;
      material.alphaTest = Math.max(material.alphaTest, 0.001);
      material.onBeforeCompile = (shader, renderer) => {
        shader.uniforms.hatMaskBoundsMin = { value: boundsMin };
        shader.uniforms.hatMaskBoundsSize = { value: boundsSize };
        shader.uniforms.hatMaskYThreshold = { value: yThresholdNormalized };
        shader.uniforms.hatMaskBillStart = { value: billStartNormalized };
        shader.uniforms.hatMaskFrontHalfWidth = {
          value: frontExemptionHalfWidthNormalized,
        };
        shader.uniforms.hatMaskOrnamentCenter = {
          value: ornamentCenter ?? new THREE.Vector2(0.5, 0.5),
        };
        shader.uniforms.hatMaskOrnamentDepthStart = {
          value: ornamentDepthStart ?? 2,
        };
        shader.uniforms.hatMaskOrnamentHalfSize = {
          value: ornamentHalfSize ?? new THREE.Vector2(0, 0),
        };
        shader.uniforms.hatMaskFeather = { value: feather };
        shader.uniforms.hatMaskTiltAmount = { value: 0 };
        tiltUniforms.push(shader.uniforms.hatMaskTiltAmount as THREE.IUniform<number>);

        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            ["#include <common>", "varying vec3 vHatMaskLocalPosition;"].join("\n"),
          )
          .replace(
            "#include <begin_vertex>",
            [
              "#include <begin_vertex>",
              "vHatMaskLocalPosition = position;",
            ].join("\n"),
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            [
              "#include <common>",
              "varying vec3 vHatMaskLocalPosition;",
              "uniform vec3 hatMaskBoundsMin;",
              "uniform vec3 hatMaskBoundsSize;",
              "uniform float hatMaskYThreshold;",
              "uniform float hatMaskBillStart;",
              "uniform float hatMaskFrontHalfWidth;",
              "uniform vec2 hatMaskOrnamentCenter;",
              "uniform float hatMaskOrnamentDepthStart;",
              "uniform vec2 hatMaskOrnamentHalfSize;",
              "uniform float hatMaskFeather;",
              "uniform float hatMaskTiltAmount;",
            ].join("\n"),
          )
          .replace(
            "#include <alphatest_fragment>",
            [
              "#include <alphatest_fragment>",
              "vec3 hatMaskNormalizedPosition = clamp((vHatMaskLocalPosition - hatMaskBoundsMin) / hatMaskBoundsSize, 0.0, 1.0);",
              "float hatUnderside = 1.0 - smoothstep(hatMaskYThreshold, hatMaskYThreshold + hatMaskFeather, hatMaskNormalizedPosition.y);",
              "float hatFrontDepth = smoothstep(hatMaskBillStart - hatMaskFeather, hatMaskBillStart + hatMaskFeather, hatMaskNormalizedPosition.z);",
              "float hatFrontWidth = 1.0 - smoothstep(hatMaskFrontHalfWidth, hatMaskFrontHalfWidth + hatMaskFeather, abs(hatMaskNormalizedPosition.x - 0.5));",
              "float hatBillExemption = clamp(hatFrontDepth * hatFrontWidth, 0.0, 1.0);",
              "float hatOrnamentDepth = smoothstep(hatMaskOrnamentDepthStart - hatMaskFeather, hatMaskOrnamentDepthStart + hatMaskFeather, hatMaskNormalizedPosition.z);",
              "vec2 hatOrnamentDelta = abs(hatMaskNormalizedPosition.xy - hatMaskOrnamentCenter);",
              "float hatOrnamentX = 1.0 - smoothstep(hatMaskOrnamentHalfSize.x, hatMaskOrnamentHalfSize.x + hatMaskFeather, hatOrnamentDelta.x);",
              "float hatOrnamentY = 1.0 - smoothstep(hatMaskOrnamentHalfSize.y, hatMaskOrnamentHalfSize.y + hatMaskFeather, hatOrnamentDelta.y);",
              "float hatOrnamentExemption = clamp(hatOrnamentDepth * hatOrnamentX * hatOrnamentY, 0.0, 1.0);",
              "float hatFrontExemption = max(hatBillExemption, hatOrnamentExemption);",
              "float hatMask = clamp(hatUnderside * (1.0 - hatFrontExemption) * hatMaskTiltAmount, 0.0, 1.0);",
              "diffuseColor.a *= 1.0 - hatMask;",
              "if (diffuseColor.a <= 0.001) discard;",
            ].join("\n"),
          );

        previousOnBeforeCompile(shader, renderer);
      };
      material.customProgramCacheKey = () => {
        return [
          previousProgramCacheKey?.() ?? "",
          "hatUndersideTransparency",
          yThresholdNormalized,
          billStartNormalized,
          frontExemptionHalfWidthNormalized,
          ornamentCenter?.x ?? -1,
          ornamentCenter?.y ?? -1,
          ornamentDepthStart ?? -1,
          ornamentHalfSize?.x ?? 0,
          ornamentHalfSize?.y ?? 0,
          feather,
          tiltStartRadians,
          tiltFullRadians,
        ].join(":");
      };
      (
        material.userData as { undersideTransparencyApplied?: boolean }
      ).undersideTransparencyApplied = true;
      material.needsUpdate = true;
    };

    if (Array.isArray(node.material)) {
      node.material.forEach(applyMaterialMask);
      return;
    }

    applyMaterialMask(node.material);
  });

  return (state: DecorationState): void => {
    const tiltRange = Math.max(tiltFullRadians - tiltStartRadians, 1e-4);
    const clampedTiltAmount = THREE.MathUtils.clamp(
      (state.upwardTiltAmount - tiltStartRadians) / tiltRange,
      0,
      1,
    );
    tiltUniforms.forEach((uniform) => {
      uniform.value = clampedTiltAmount;
    });
  };
}

/**
 * Builds a text geometry that is projected onto the front of the hat surface.
 *
 * Each grid vertex is raycast back onto the model so the text hugs the front
 * shell instead of floating as a flat card in front of the geometry.
 *
 * @param model - Loaded GLTF scene root receiving the text mesh
 * @param bounds - Base model bounds used to size and seed the projection
 * @param frontText - Text decoration settings for the active model
 * @returns Buffer geometry whose vertices already sit in model-local space
 */
function createProjectedFrontTextGeometry(
  model: THREE.Object3D,
  bounds: THREE.Box3,
  frontText: NonNullable<ModelConfig["frontText"]>,
): THREE.BufferGeometry {
  const size = bounds.getSize(new THREE.Vector3());
  const center = new THREE.Vector3(
    bounds.min.x + size.x * frontText.positionNormalized.x,
    bounds.min.y + size.y * frontText.positionNormalized.y,
    bounds.min.z + size.z * frontText.positionNormalized.z,
  );
  const width = Math.max(size.x * frontText.sizeNormalized.width, 1e-4);
  const height = Math.max(size.y * frontText.sizeNormalized.height, 1e-4);
  const geometry = new THREE.PlaneGeometry(width, height, 42, 14);
  const positions = geometry.attributes.position;
  const raycaster = new THREE.Raycaster();
  const projectionStartDepth = bounds.max.z + size.z * 0.35;
  model.updateMatrixWorld(true);
  const modelWorldDirection = new THREE.Vector3(0, 0, -1).transformDirection(
    model.matrixWorld,
  );
  for (let index = 0; index < positions.count; index += 1) {
    const localX = positions.getX(index);
    const localY = positions.getY(index);
    const sampleLocal = new THREE.Vector3(center.x + localX, center.y + localY, center.z);
    const rayOriginLocal = sampleLocal.clone();
    rayOriginLocal.z = projectionStartDepth;
    const rayOriginWorld = model.localToWorld(rayOriginLocal.clone());
    raycaster.set(rayOriginWorld, modelWorldDirection);
    const intersections = raycaster.intersectObject(model, true);
    const hit = intersections.find((entry) => entry.object instanceof THREE.Mesh);
    const hitLocal = hit
      ? model.worldToLocal(hit.point.clone())
      : sampleLocal.clone();
    positions.setXYZ(
      index,
      hitLocal.x,
      hitLocal.y,
      hitLocal.z + frontText.surfaceOffset,
    );
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Builds the alpha texture used by the front text shader.
 *
 * The texture uses transparent background so the text can sit flush against
 * the hat surface without covering surrounding geometry.
 *
 * @param text - Visible text rendered into the decal texture
 * @param color - Solid fill color used for the text
 * @returns Canvas-backed texture used by the shader material
 */
function createFrontTextTexture(
  text: string,
  color: string,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Expected 2D canvas context for model decoration texture.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 112px Georgia, 'Times New Roman', serif";
  context.fillStyle = color;
  context.fillText(text, canvas.width * 0.5, canvas.height * 0.52);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
