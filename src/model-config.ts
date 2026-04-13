import { publicAssetUrl } from "./runtime-paths";

/**
 * Named runtime configuration for a selectable face filter model.
 *
 * Couples the GLB asset with an optional material overrides JSON file so the
 * renderer can swap models without changing the tracking pipeline.
 */
export type ModelConfig = {
  /**
   * Stable query-string identifier used in `?model=...`.
   */
  id: string;
  /**
   * Human-readable name used in UI copy and logs.
   */
  displayName: string;
  /**
   * Public URL for the GLB asset.
   */
  modelUrl: string;
  /**
   * Optional public URL for runtime material overrides.
   *
   * When undefined, the model uses the default material profile only.
   */
  overridesUrl?: string;
  /**
   * Tracking behavior used to place the model on the detected subject.
   *
   * `body-overlay` keeps the existing torso/face fusion used by the lobster.
   * `headwear` follows face-derived head placement so hats sit on top of the head.
   */
  anchorMode: "body-overlay" | "headwear";
  /**
   * Headwear fit configuration derived from the model's local bounds space.
   *
   * `attachPointNormalized` describes the local point on the model that should
   * contact the user's head. `widthAxis` chooses which local axis should match
   * the user's head width, and `headWidthMultiplier` lets the model sit a bit
   * wider than the raw temple span when desired.
   */
  headwearFit?: {
    /**
     * Normalized bounds-space point used as the head contact anchor.
     */
    attachPointNormalized: {
      x: number;
      y: number;
      z: number;
    };
    /**
     * Bounds axis used as the fit-width reference.
     */
    widthAxis: "x" | "z";
    /**
     * Multiplier applied to measured temple width before solving scale.
     */
    headWidthMultiplier: number;
    /**
     * Extra crown lift measured in temple-width units.
     */
    crownLiftFromWidth: number;
    /**
     * Extra backward inset measured in temple-width units.
     *
     * Positive values pull the model back onto the head along its rotated local
     * depth axis so it does not hover in front of the face plane.
     */
    depthInsetFromWidth: number;
  };
  /**
   * Optional underside transparency mask for single-material headwear models.
   *
   * The mask uses local model bounds so the lower interior of a hat can be
   * hidden while keeping the front bill region opaque.
   */
  undersideTransparency?: {
    /**
     * Normalized Y threshold below which the underside starts.
     */
    yThresholdNormalized: number;
    /**
     * Normalized Z threshold where the front exemption begins.
     */
    billStartNormalized: number;
    /**
     * Half-width of the front exemption, measured from model center in
     * normalized X space.
     */
    frontExemptionHalfWidthNormalized: number;
    /**
     * Optional front ornament keep-out zone that stays opaque during underside
     * fading so decorative front details are not clipped.
     */
    ornamentExemptionNormalized?: {
      /**
       * Center of the ornament keep-out zone in normalized model space.
       */
      center: {
        x: number;
        y: number;
      };
      /**
       * Normalized Z threshold where ornament preservation begins.
       */
      depthStartNormalized: number;
      /**
       * Size of the ornament keep-out zone in normalized model space.
       */
      size: {
        width: number;
        height: number;
      };
    };
    /**
     * Feather width used to soften the underside transition.
     */
    feather: number;
    /**
     * Upward head pitch in radians where underside fading begins.
     */
    tiltStartRadians: number;
    /**
     * Upward head pitch in radians where underside fading reaches full strength.
     */
    tiltFullRadians: number;
  };
  /**
   * Optional front-facing text decoration rendered in front of the model.
   *
   * This is useful for lightweight decals such as hat bands or slogan text
   * without requiring a new GLB export.
   */
  frontText?: {
    /**
     * Text content rendered on the decal.
     */
    text: string;
    /**
     * Normalized bounds-space position for the decal center.
     */
    positionNormalized: {
      x: number;
      y: number;
      z: number;
    };
    /**
     * Width and height measured as fractions of the model bounds.
     */
    sizeNormalized: {
      width: number;
      height: number;
    };
    /**
     * Small local-space offset that keeps the text just above the surface.
     */
    surfaceOffset: number;
    /**
     * Solid text color baked into the decal texture.
     */
    color: string;
  };
  /**
   * Base transform applied after the model is attached to the tracking anchor.
   *
   * These values are the model-specific fit knobs that control how a GLB sits
   * on the tracked body before per-frame tracking updates are applied.
   */
  bodyTransform: {
    /**
     * Uniform scalar applied to the loaded model.
     */
    scaleMultiplier: number;
    /**
     * Base local-space translation applied before tracking updates.
     */
    offset: {
      x: number;
      y: number;
      z: number;
    };
    /**
     * Base local-space Euler rotation applied before tracking updates.
     */
    rotation: {
      x: number;
      y: number;
      z: number;
    };
    /**
     * When true, subtracts the model bounds center from the configured X offset.
     */
    autoCenterX: boolean;
  };
};

/**
 * Default model id used when no explicit query override is provided.
 */
const DEFAULT_MODEL_ID = "lobster";

/**
 * Query-string parameter used to select a model configuration.
 */
const MODEL_QUERY_PARAM = "model";

/**
 * Model id aliases retained for backwards compatibility with older URLs.
 */
const MODEL_ID_ALIASES: Record<string, string> = {
  filter: DEFAULT_MODEL_ID,
  "textured-mesh": "bowling-hat",
  textured_mesh: "bowling-hat",
};

/**
 * Registry of supported runtime model configurations.
 *
 * The lobster model remains the default configuration, while the second
 * configuration exposes the bowling hat model under a descriptive id.
 */
const MODEL_CONFIGS: Record<string, ModelConfig> = {
  lobster: {
    id: "lobster",
    displayName: "Lobster",
    modelUrl: publicAssetUrl("models/lobster.glb"),
    overridesUrl: publicAssetUrl("models/lobster-overrides.json"),
    anchorMode: "body-overlay",
    bodyTransform: {
      scaleMultiplier: 0.9,
      offset: {
        x: -0.14,
        y: -0.41,
        z: 0,
      },
      rotation: {
        x: Math.PI,
        y: Math.PI,
        z: Math.PI,
      },
      autoCenterX: true,
    },
  },
  "bowling-hat": {
    id: "bowling-hat",
    displayName: "Bowling Hat",
    modelUrl: publicAssetUrl("models/bowling-hat.glb"),
    anchorMode: "headwear",
    headwearFit: {
      attachPointNormalized: {
        x: 0.5,
        y: 0.12,
        z: 0.56,
      },
      widthAxis: "x",
      headWidthMultiplier: 1.35,
      crownLiftFromWidth: 0.44,
      depthInsetFromWidth: 0.45,
    },
    undersideTransparency: {
      yThresholdNormalized: 0.42,
      billStartNormalized: 0.46,
      frontExemptionHalfWidthNormalized: 0.38,
      ornamentExemptionNormalized: {
        center: {
          x: 0.5,
          y: 0.37,
        },
        depthStartNormalized: 0.24,
        size: {
          width: 0.58,
          height: 0.56,
        },
      },
      feather: 0.035,
      tiltStartRadians: 0.12,
      tiltFullRadians: 0.34,
    },
    frontText: {
      text: "Can't Escape",
      positionNormalized: {
        x: 0.5,
        y: 0.49,
        z: 0.87,
      },
      sizeNormalized: {
        width: 0.58,
        height: 0.14,
      },
      surfaceOffset: 0.0008,
      color: "#111111",
    },
    bodyTransform: {
      scaleMultiplier: 0.34,
      offset: {
        x: -0.01,
        y: 0.44,
        z: 0,
      },
      rotation: {
        x: 0,
        y: 0,
        z: 0,
      },
      autoCenterX: true,
    },
  },
};

/**
 * Resolves a model id to a supported runtime configuration.
 *
 * Unknown ids and empty values fall back to the default lobster configuration.
 * Legacy ids such as `filter` are mapped to their modern configuration ids.
 *
 * @param modelId - Requested model id from URL state or other runtime input
 * @returns Supported model configuration, defaulting to lobster when needed
 */
export function getModelConfig(modelId?: string | null): ModelConfig {
  const normalizedModelId = modelId?.trim().toLowerCase();
  if (!normalizedModelId) {
    return MODEL_CONFIGS[DEFAULT_MODEL_ID];
  }

  const resolvedModelId =
    MODEL_ID_ALIASES[normalizedModelId] ?? normalizedModelId;

  return MODEL_CONFIGS[resolvedModelId] ?? MODEL_CONFIGS[DEFAULT_MODEL_ID];
}

/**
 * Resolves the active model configuration from a URL search string.
 *
 * Reads the `model` query parameter and returns a supported configuration.
 * Invalid or missing values safely fall back to the default lobster model.
 *
 * @param search - URL search string to inspect for model selection
 * @returns Active model configuration for the current runtime session
 */
export function resolveModelConfig(search: string): ModelConfig {
  const params = new URLSearchParams(search);
  return getModelConfig(params.get(MODEL_QUERY_PARAM));
}

/**
 * Lists supported model configurations in their preferred display order.
 *
 * @returns Array of available runtime model configurations
 */
export function listModelConfigs(): ModelConfig[] {
  return Object.values(MODEL_CONFIGS);
}
