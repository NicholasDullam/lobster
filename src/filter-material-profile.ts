import * as THREE from "three";

/**
 * Runtime material tuning options used to adjust how the filter blends with
 * the underlying subject.
 */
export type FilterMaterialTuning = {
  /**
   * Opacity in the range [0, 1], where lower values reveal more of the subject.
   */
  opacity: number;
  /**
   * Alpha cutoff in the range [0, 1] for texture-based transparency clipping.
   */
  alphaTest: number;
  /**
   * Enables/disables writing to depth buffer.
   */
  depthWrite: boolean;
  /**
   * Enables/disables depth testing against existing depth buffer values.
   */
  depthTest: boolean;
  /**
   * Enables rendering both triangle sides.
   */
  doubleSided: boolean;
  /**
   * Marks the material as using alpha blending.
   */
  transparent: boolean;
  /**
   * Optional render order bias applied on matching meshes.
   */
  renderOrder?: number;
};

/**
 * Per-mesh/material runtime override for face-through tuning.
 *
 * The matcher compares lowercased mesh and material names using substring
 * matching, allowing broad targeting such as "face|head|visor".
 */
export type FilterMaterialOverride = {
  /**
   * Pipe-delimited matcher terms tested against mesh and material names.
   */
  matcher: string;
} & Partial<FilterMaterialTuning>;

/**
 * Profile used to tune filter rendering globally and for matching submeshes.
 */
export type FilterMaterialProfile = {
  /**
   * Global material tuning defaults applied to all mesh materials.
   */
  base: FilterMaterialTuning;
  /**
   * Ordered per-mesh/material overrides. Later matches win.
   */
  overrides: FilterMaterialOverride[];
  /**
   * Localized mesh cutout windows used to create non-global pass-through areas.
   */
  cutouts: FilterCutoutWindow[];
};

/**
 * Elliptical cutout window in mesh-local space for non-global face-through.
 */
export type FilterCutoutWindow = {
  /**
   * Enables/disables this cutout entry.
   */
  enabled: boolean;
  /**
   * Pipe-delimited matcher terms tested against mesh and material names.
   */
  matcher: string;
  /**
   * Local-space center of the cutout ellipsoid.
   */
  center: [number, number, number];
  /**
   * Local-space radii of the cutout ellipsoid.
   */
  radii: [number, number, number];
  /**
   * Feather width around ellipsoid edge, in normalized radius space.
   */
  feather: number;
};

type CutoutMaterialState = {
  center: THREE.Vector3;
  radii: THREE.Vector3;
  feather: { value: number };
  debug: {
    visualize: { value: number };
    translucentOpacity: { value: number };
    shaderEnabled: { value: number };
  };
  uniforms?: {
    center: THREE.IUniform<THREE.Vector3>;
    radii: THREE.IUniform<THREE.Vector3>;
    feather: THREE.IUniform<number>;
    visualize: THREE.IUniform<number>;
    translucentOpacity: THREE.IUniform<number>;
    shaderEnabled: THREE.IUniform<number>;
  };
};

const MIN_CUTOUT_VALUE = 1e-4;
const LEGACY_OUTPUT_FRAGMENT_TOKEN = "#include <output_fragment>";
const CURRENT_OUTPUT_FRAGMENT_TOKEN = "#include <opaque_fragment>";

type CompiledMaterialShader = {
  uniforms: Record<string, THREE.IUniform<unknown>>;
  vertexShader: string;
  fragmentShader: string;
};

/**
 * Shader debug controls for interactive cutout tuning mode.
 */
export type FilterCutoutDebugState = {
  /**
   * When true, shader tints regions by cutout occlusion contribution.
   */
  visualizeOcclusion: boolean;
  /**
   * When true, keeps the cutout shader active for face pass-through.
   */
  shaderEnabled: boolean;
  /**
   * Optional translucent mesh opacity for tuning context.
   */
  translucentMeshOpacity: number;
};

/**
 * Runtime artifact structure loaded from `/models/filter-overrides.json`.
 *
 * Partial values are merged onto the default profile to allow lightweight
 * overrides without requiring all fields to be present.
 */
export type FilterMaterialProfileArtifact = {
  base?: Partial<FilterMaterialTuning>;
  overrides?: FilterMaterialOverride[];
  cutouts?: FilterCutoutWindow[];
};

/**
 * Default runtime profile for face-through behavior.
 *
 * Keeps the model fully opaque by default, while making only likely
 * face-adjacent parts more permissive so facial features can read through.
 */
export const DEFAULT_FILTER_MATERIAL_PROFILE: FilterMaterialProfile = {
  base: {
    opacity: 1,
    alphaTest: 0,
    depthWrite: true,
    depthTest: true,
    doubleSided: false,
    transparent: false,
  },
  overrides: [
    {
      matcher: "face|head|visor|window|opening|mask|hood",
      opacity: 0.58,
      depthWrite: false,
      doubleSided: true,
      alphaTest: 0.01,
      transparent: true,
    },
  ],
  cutouts: [],
};

/**
 * Merges a partial runtime artifact on top of a base profile.
 *
 * @param baseProfile - Base profile to clone and extend
 * @param artifact - Partial artifact values loaded from JSON
 * @returns Fully merged profile
 */
export function mergeProfileArtifact(
  baseProfile: FilterMaterialProfile,
  artifact: FilterMaterialProfileArtifact | null,
): FilterMaterialProfile {
  const merged: FilterMaterialProfile = {
    base: { ...baseProfile.base },
    overrides: baseProfile.overrides.map((entry) => ({ ...entry })),
    cutouts: baseProfile.cutouts.map((entry) => ({ ...entry })),
  };
  if (!artifact) {
    return merged;
  }

  if (artifact.base) {
    merged.base = { ...merged.base, ...definedProps(artifact.base) };
  }
  if (artifact.overrides) {
    merged.overrides = artifact.overrides.map((entry) => ({ ...entry }));
  }
  if (artifact.cutouts) {
    merged.cutouts = artifact.cutouts.map((entry) => ({ ...entry }));
  }
  return merged;
}

/**
 * Loads a JSON runtime artifact from the public models directory.
 *
 * Missing files are treated as optional and return null.
 *
 * @param url - Public URL to the runtime JSON artifact
 * @returns Parsed artifact or null when unavailable/invalid
 */
export async function loadProfileArtifact(
  url: string,
): Promise<FilterMaterialProfileArtifact | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const parsed = (await response.json()) as unknown;
    return isProfileArtifact(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Resolves effective tuning for a mesh/material pair.
 *
 * Applies the base profile first, then merges all matching overrides in order
 * so the last match takes precedence.
 *
 * @param profile - Active runtime profile with base and overrides
 * @param meshName - Current mesh name from the loaded GLB scene
 * @param materialName - Current material name from the loaded GLB scene
 * @returns Effective material tuning for the given mesh/material
 */
export function resolveFilterMaterialTuning(
  profile: FilterMaterialProfile,
  meshName: string,
  materialName: string,
): FilterMaterialTuning {
  const effective: FilterMaterialTuning = { ...profile.base };
  for (const override of profile.overrides) {
    if (!matchesOverride(override, meshName, materialName)) {
      continue;
    }

    if (override.opacity !== undefined) {
      effective.opacity = override.opacity;
    }
    if (override.alphaTest !== undefined) {
      effective.alphaTest = override.alphaTest;
    }
    if (override.depthWrite !== undefined) {
      effective.depthWrite = override.depthWrite;
    }
    if (override.depthTest !== undefined) {
      effective.depthTest = override.depthTest;
    }
    if (override.doubleSided !== undefined) {
      effective.doubleSided = override.doubleSided;
    }
    if (override.transparent !== undefined) {
      effective.transparent = override.transparent;
    }
    if (override.renderOrder !== undefined) {
      effective.renderOrder = override.renderOrder;
    }
  }
  return effective;
}

/**
 * Builds a runtime profile using URL query parameter overrides.
 *
 * Supported params:
 * - `filterOpacity`, `filterAlphaTest`, `filterDepthWrite`, `filterDepthTest`,
 *   `filterDoubleSided`, `filterTransparent`, `filterRenderOrder`
 * - `filterTarget` (pipe-delimited matcher terms)
 * - `filterTargetOpacity`, `filterTargetAlphaTest`, `filterTargetDepthWrite`,
 *   `filterTargetDepthTest`, `filterTargetDoubleSided`,
 *   `filterTargetTransparent`, `filterTargetRenderOrder`
 *
 * @param search - URL search string, e.g. `window.location.search`
 * @param baseProfile - Base profile to clone and then override
 * @returns Profile merged with query overrides for quick tuning
 */
export function profileFromQueryParams(
  search: string,
  baseProfile: FilterMaterialProfile = DEFAULT_FILTER_MATERIAL_PROFILE,
): FilterMaterialProfile {
  const params = new URLSearchParams(search);
  const profile: FilterMaterialProfile = {
    base: { ...baseProfile.base },
    overrides: baseProfile.overrides.map((entry) => ({ ...entry })),
    cutouts: baseProfile.cutouts.map((entry) => ({ ...entry })),
  };

  const queryBasePatch: Partial<FilterMaterialTuning> = {
    opacity: readClampedNumber(params, "filterOpacity", 0, 1),
    alphaTest: readClampedNumber(params, "filterAlphaTest", 0, 1),
    depthWrite: readBoolean(params, "filterDepthWrite"),
    depthTest: readBoolean(params, "filterDepthTest"),
    doubleSided: readBoolean(params, "filterDoubleSided"),
    transparent: readBoolean(params, "filterTransparent"),
    renderOrder: readNumber(params, "filterRenderOrder"),
  };
  profile.base = { ...profile.base, ...definedProps(queryBasePatch) };

  const targetMatcher = params.get("filterTarget")?.trim();
  if (targetMatcher) {
    const targetPatch: Partial<FilterMaterialTuning> = definedProps({
      opacity: readClampedNumber(params, "filterTargetOpacity", 0, 1),
      alphaTest: readClampedNumber(params, "filterTargetAlphaTest", 0, 1),
      depthWrite: readBoolean(params, "filterTargetDepthWrite"),
      depthTest: readBoolean(params, "filterTargetDepthTest"),
      doubleSided: readBoolean(params, "filterTargetDoubleSided"),
      transparent: readBoolean(params, "filterTargetTransparent"),
      renderOrder: readNumber(params, "filterTargetRenderOrder"),
    });
    if (Object.keys(targetPatch).length > 0) {
      profile.overrides.push({
        matcher: targetMatcher,
        ...targetPatch,
      });
    }
  }

  const queryCutout = readCutoutFromQueryParams(params);
  if (queryCutout) {
    profile.cutouts.push(queryCutout);
  }

  return profile;
}

/**
 * Applies resolved tuning to a Three.js material.
 *
 * @param material - Material clone to mutate
 * @param tuning - Effective tuning values for this material
 */
export function applyTuningToMaterial(
  material: THREE.Material,
  tuning: FilterMaterialTuning,
): void {
  material.transparent = tuning.transparent;
  material.opacity = tuning.opacity;
  material.alphaTest = tuning.alphaTest;
  material.depthWrite = tuning.depthWrite;
  material.depthTest = tuning.depthTest;
  material.side = tuning.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  material.needsUpdate = true;
}

/**
 * Returns the first enabled cutout that matches the mesh/material pair.
 *
 * @param profile - Active profile containing cutout entries
 * @param meshName - Mesh name from loaded GLB
 * @param materialName - Material name from loaded GLB
 * @returns Matching cutout window or null when no match exists
 */
export function resolveCutoutForMaterial(
  profile: FilterMaterialProfile,
  meshName: string,
  materialName: string,
): FilterCutoutWindow | null {
  let match: FilterCutoutWindow | null = null;
  for (const cutout of profile.cutouts) {
    if (!cutout.enabled) {
      continue;
    }
    if (!matchesOverride({ matcher: cutout.matcher }, meshName, materialName)) {
      continue;
    }
    // Later entries win so query-time overrides can replace artifact defaults.
    match = cutout;
  }
  return match;
}

/**
 * Injects a local-space cutout window into a material shader.
 *
 * The cutout uses an ellipsoid signed-distance field in mesh-local space so
 * transparency affects only the configured region, not the whole model.
 *
 * @param material - Cloned material to augment
 * @param cutout - Local cutout configuration
 */
export function applyCutoutToMaterial(
  material: THREE.Material,
  cutout: FilterCutoutWindow,
  debugState?: FilterCutoutDebugState,
): void {
  const state = createCutoutMaterialState(cutout, debugState);
  (material.userData as { filterCutoutState?: CutoutMaterialState }).filterCutoutState =
    state;

  // Cutout relies on alpha modulation in fragment shader.
  material.transparent = true;

  material.onBeforeCompile = (shader) => {
    attachCutoutUniforms(shader, state);
    shader.vertexShader = injectCutoutVertexShader(shader.vertexShader);
    shader.fragmentShader = injectCutoutFragmentShader(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => {
    return [
      "filterCutout",
      cutout.matcher,
      ...cutout.center,
      ...cutout.radii,
      cutout.feather,
    ].join(":");
  };
  material.needsUpdate = true;
}

/**
 * Updates cutout shader uniforms for an already-augmented material.
 *
 * @param material - Material previously configured with applyCutoutToMaterial
 * @param cutout - Updated cutout values to push into shader uniforms
 */
export function updateCutoutMaterialState(
  material: THREE.Material,
  cutout: FilterCutoutWindow,
): void {
  const state = (material.userData as { filterCutoutState?: CutoutMaterialState })
    .filterCutoutState;
  if (!state) {
    return;
  }
  state.center.set(...cutout.center);
  state.radii.set(
    Math.max(MIN_CUTOUT_VALUE, cutout.radii[0]),
    Math.max(MIN_CUTOUT_VALUE, cutout.radii[1]),
    Math.max(MIN_CUTOUT_VALUE, cutout.radii[2]),
  );
  state.feather.value = Math.max(MIN_CUTOUT_VALUE, cutout.feather);
  if (state.uniforms) {
    state.uniforms.center.value.copy(state.center);
    state.uniforms.radii.value.copy(state.radii);
    state.uniforms.feather.value = state.feather.value;
  }
}

/**
 * Updates cutout shader debug uniforms for an augmented material.
 *
 * @param material - Material previously configured with applyCutoutToMaterial
 * @param debugState - Runtime debug controls for occlusion visualization
 */
export function updateCutoutDebugState(
  material: THREE.Material,
  debugState: FilterCutoutDebugState,
): void {
  const state = (material.userData as { filterCutoutState?: CutoutMaterialState })
    .filterCutoutState;
  if (!state) {
    return;
  }
  state.debug.visualize.value = debugState.visualizeOcclusion ? 1 : 0;
  state.debug.shaderEnabled.value = debugState.shaderEnabled ? 1 : 0;
  state.debug.translucentOpacity.value = THREE.MathUtils.clamp(
    debugState.translucentMeshOpacity,
    0,
    1,
  );
  if (state.uniforms) {
    state.uniforms.visualize.value = state.debug.visualize.value;
    state.uniforms.shaderEnabled.value = state.debug.shaderEnabled.value;
    state.uniforms.translucentOpacity.value = state.debug.translucentOpacity.value;
  }
}

function matchesOverride(
  override: FilterMaterialOverride,
  meshName: string,
  materialName: string,
): boolean {
  const haystack = `${meshName}|${materialName}`.toLowerCase();
  const terms = override.matcher
    .split("|")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) {
    return false;
  }
  return terms.some((term) => haystack.includes(term));
}

function readNumber(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readClampedNumber(
  params: URLSearchParams,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const value = readNumber(params, key);
  if (value === undefined) {
    return undefined;
  }
  return THREE.MathUtils.clamp(value, min, max);
}

function readBoolean(params: URLSearchParams, key: string): boolean | undefined {
  const raw = params.get(key);
  if (raw === null) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }
  return undefined;
}

function readTuple3(
  params: URLSearchParams,
  key: string,
): [number, number, number] | undefined {
  const raw = params.get(key);
  if (!raw) {
    return undefined;
  }
  const parts = raw.split(",").map((entry) => Number(entry.trim()));
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) {
    return undefined;
  }
  return [parts[0], parts[1], parts[2]];
}

function readCutoutFromQueryParams(
  params: URLSearchParams,
): FilterCutoutWindow | null {
  const enabled = readBoolean(params, "filterCutoutEnabled");
  const matcher = params.get("filterCutoutMatcher")?.trim();
  const center = readTuple3(params, "filterCutoutCenter");
  const radii = readTuple3(params, "filterCutoutRadii");
  const feather = readNumber(params, "filterCutoutFeather");
  if (!matcher || !center || !radii || feather === undefined) {
    return null;
  }
  return {
    enabled: enabled ?? true,
    matcher,
    center,
    radii,
    feather: Math.max(MIN_CUTOUT_VALUE, feather),
  };
}

function definedProps<T extends object>(value: T): Partial<T> {
  const entries = Object.entries(value).filter(([, entryValue]) => {
    return entryValue !== undefined;
  });
  return Object.fromEntries(entries) as Partial<T>;
}

function isProfileArtifact(value: unknown): value is FilterMaterialProfileArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as {
    base?: unknown;
    overrides?: unknown;
    cutouts?: unknown;
  };
  if (candidate.base !== undefined && !isRecord(candidate.base)) {
    return false;
  }
  if (candidate.overrides !== undefined && !Array.isArray(candidate.overrides)) {
    return false;
  }
  if (candidate.cutouts !== undefined && !Array.isArray(candidate.cutouts)) {
    return false;
  }
  return true;
}

/**
 * Creates shader state for a single cutout entry.
 *
 * Clamps radii and feather to avoid divide-by-zero and unstable edge behavior
 * when users provide tiny values through JSON or query params.
 *
 * @param cutout - Cutout window values in mesh-local space
 * @param debugState - Optional runtime debug controls for visualization/opacity
 * @returns Prepared cutout state used by shader uniforms and live updates
 */
function createCutoutMaterialState(
  cutout: FilterCutoutWindow,
  debugState?: FilterCutoutDebugState,
): CutoutMaterialState {
  return {
    center: new THREE.Vector3(...cutout.center),
    radii: new THREE.Vector3(
      Math.max(MIN_CUTOUT_VALUE, cutout.radii[0]),
      Math.max(MIN_CUTOUT_VALUE, cutout.radii[1]),
      Math.max(MIN_CUTOUT_VALUE, cutout.radii[2]),
    ),
    feather: { value: Math.max(MIN_CUTOUT_VALUE, cutout.feather) },
    debug: {
      visualize: { value: debugState?.visualizeOcclusion ? 1 : 0 },
      shaderEnabled: { value: debugState?.shaderEnabled === false ? 0 : 1 },
      translucentOpacity: {
        value: debugState
          ? THREE.MathUtils.clamp(debugState.translucentMeshOpacity, 0, 1)
          : 0,
      },
    },
  };
}

/**
 * Attaches cutout uniforms to the material shader and stores uniform handles.
 *
 * Stored handles are reused by update helpers so the tuner can push changes
 * without recompiling materials.
 *
 * @param shader - Three.js shader object from onBeforeCompile
 * @param state - Cutout state backing uniform values
 */
function attachCutoutUniforms(
  shader: CompiledMaterialShader,
  state: CutoutMaterialState,
): void {
  shader.uniforms.filterCutoutCenter = { value: state.center };
  shader.uniforms.filterCutoutRadii = { value: state.radii };
  shader.uniforms.filterCutoutFeather = { value: state.feather.value };
  shader.uniforms.filterCutoutDebugVisualize = { value: state.debug.visualize.value };
  shader.uniforms.filterCutoutShaderEnabled = {
    value: state.debug.shaderEnabled.value,
  };
  shader.uniforms.filterCutoutDebugMeshOpacity = {
    value: state.debug.translucentOpacity.value,
  };
  state.uniforms = {
    center: shader.uniforms.filterCutoutCenter as THREE.IUniform<THREE.Vector3>,
    radii: shader.uniforms.filterCutoutRadii as THREE.IUniform<THREE.Vector3>,
    feather: shader.uniforms.filterCutoutFeather as THREE.IUniform<number>,
    visualize: shader.uniforms.filterCutoutDebugVisualize as THREE.IUniform<number>,
    shaderEnabled:
      shader.uniforms.filterCutoutShaderEnabled as THREE.IUniform<number>,
    translucentOpacity:
      shader.uniforms.filterCutoutDebugMeshOpacity as THREE.IUniform<number>,
  };
}

/**
 * Injects local-position varying setup required for cutout distance checks.
 *
 * @param vertexShader - Original material vertex shader source
 * @returns Vertex shader source including cutout local-position varyings
 */
function injectCutoutVertexShader(vertexShader: string): string {
  return vertexShader
    .replace(
      "#include <common>",
      [
        "#include <common>",
        "varying vec3 vFilterLocalPos;",
      ].join("\n"),
    )
    .replace(
      "#include <begin_vertex>",
      [
        "#include <begin_vertex>",
        "vFilterLocalPos = position;",
      ].join("\n"),
    );
}

/**
 * Injects cutout alpha logic into the fragment shader output path.
 *
 * Supports both legacy `output_fragment` and current `opaque_fragment` chunk
 * names so behavior remains stable across Three.js shader chunk migrations.
 *
 * @param fragmentShader - Original material fragment shader source
 * @returns Fragment shader source with cutout fade/discard logic
 */
function injectCutoutFragmentShader(fragmentShader: string): string {
  const outputChunkToken = resolveFragmentOutputChunkToken(fragmentShader);
  return fragmentShader
    .replace(
      "#include <common>",
      [
        "#include <common>",
        "varying vec3 vFilterLocalPos;",
        "uniform vec3 filterCutoutCenter;",
        "uniform vec3 filterCutoutRadii;",
        "uniform float filterCutoutFeather;",
        "uniform float filterCutoutDebugVisualize;",
        "uniform float filterCutoutShaderEnabled;",
        "uniform float filterCutoutDebugMeshOpacity;",
      ].join("\n"),
    )
    .replace(
      outputChunkToken,
      [
        "vec3 filterOffset = (vFilterLocalPos - filterCutoutCenter) / filterCutoutRadii;",
        "float filterDist = length(filterOffset) - 1.0;",
        "float filterFade = smoothstep(-filterCutoutFeather, filterCutoutFeather, filterDist);",
        "if (filterCutoutShaderEnabled > 0.5) {",
        "  if (filterCutoutDebugVisualize > 0.5) {",
        "    vec3 occlusionTint = mix(vec3(0.15, 0.95, 1.0), vec3(1.0, 0.35, 0.18), clamp(1.0 - filterFade, 0.0, 1.0));",
        "    diffuseColor.rgb = mix(diffuseColor.rgb, occlusionTint, 0.65);",
        "  }",
        "  if (filterCutoutDebugMeshOpacity > 0.0) {",
        "    diffuseColor.a = max(diffuseColor.a, filterCutoutDebugMeshOpacity);",
        "  }",
        "  diffuseColor.a *= filterFade;",
        "  if (diffuseColor.a <= 0.001) discard;",
        "}",
        outputChunkToken,
      ].join("\n"),
    );
}

/**
 * Resolves the active fragment output include token for the current shader.
 *
 * @param fragmentShader - Fragment shader source generated by Three.js
 * @returns Matching output include token used as injection anchor
 */
function resolveFragmentOutputChunkToken(fragmentShader: string): string {
  return fragmentShader.includes(LEGACY_OUTPUT_FRAGMENT_TOKEN)
    ? LEGACY_OUTPUT_FRAGMENT_TOKEN
    : CURRENT_OUTPUT_FRAGMENT_TOKEN;
}

/**
 * Checks whether a value is a non-array object record.
 *
 * @param value - Unknown runtime value to validate
 * @returns True when value is an object-like record
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
