import { baseRelativePathname, publicAssetUrl } from "./runtime-paths";

const SAMPLE_ROUTE_PREFIX = "/samples/";

/**
 * Pose landmark index for the left shoulder.
 */
const LM_LEFT_SHOULDER = 11;

/**
 * Pose landmark index for the right shoulder.
 */
const LM_RIGHT_SHOULDER = 12;

/**
 * Pose landmark index for the left hip.
 */
const LM_LEFT_HIP = 23;

/**
 * Pose landmark index for the right hip.
 */
const LM_RIGHT_HIP = 24;

/**
 * Face landmark index for the upper forehead.
 */
const FM_FOREHEAD = 10;

/**
 * Face landmark index for the nose tip.
 */
const FM_NOSE_TIP = 1;

/**
 * Face landmark index for the outer left eye corner.
 */
const FM_LEFT_EYE_OUTER = 33;

/**
 * Face landmark index near the left temple / side of the head.
 */
const FM_LEFT_TEMPLE = 234;

/**
 * Face landmark index for the outer right eye corner.
 */
const FM_RIGHT_EYE_OUTER = 263;

/**
 * Face landmark index near the right temple / side of the head.
 */
const FM_RIGHT_TEMPLE = 454;

/**
 * Body anchor smoothing and visibility thresholds.
 */
const BODY_POS_SMOOTH = 0.86;
const BODY_ROT_SMOOTH = 0.9;
const BODY_SCALE_SMOOTH = 0.85;
const BODY_POSITION_DEADBAND = 0.012;
const BODY_ROTATION_DEADBAND_RAD = 0.02;
const BODY_MIN_VISIBILITY = 0.55;
const POSE_LOST_HIDE_DELAY_MS = 320;

const BODY_ROLL_FROM_SHOULDERS = 0.4;

/**
 * Head orientation blending controls.
 */
const HEAD_YAW_FROM_NOSE_OFFSET = 1.8;
const HEAD_YAW_BLEND_WEIGHT = 0.82;
const HEAD_PITCH_BLEND_WEIGHT = 0.72;
const HEAD_ROLL_BLEND_WEIGHT = 0.82;
const HEAD_PITCH_NEUTRAL_NOSE_EYE_RATIO = 0.58;
const HEAD_PITCH_FROM_NOSE_OFFSET = 1.35;
const HEAD_MAX_YAW_DELTA_FROM_TORSO = 0.65;
const HEAD_MAX_PITCH_DELTA_FROM_TORSO = 0.5;
const HEAD_MAX_ROLL_DELTA_FROM_TORSO = 0.55;
const HEAD_ROLL_SIGN = -1;
const HEAD_ROLL_FROM_YAW = 0.2;

/**
 * Face anchor and cutout fitting controls.
 */
const MIN_FACE_EYE_DISTANCE = 0.03;
const FACE_ANCHOR_POSITION_BLEND_CAMERA = 0.7;
const FACE_ANCHOR_POSITION_BLEND_SAMPLE = 0.82;
const FACE_ANCHOR_SCALE_BLEND_CAMERA = 0.98;
const FACE_ANCHOR_SCALE_BLEND_SAMPLE = 1;
const FACE_SCALE_MULTIPLIER = 18.5;
const FACE_SCALE_MIN = 0.72;
const FACE_SCALE_MAX = 2.5;
const FACE_SCALE_DYNAMIC_BLEND_MIN = 0.9;
const FACE_SCALE_DYNAMIC_BLEND_MAX = 1;
const FACE_SCALE_FIT_PADDING = 1.24;
const FACE_WINDOW_WIDTH_FROM_EYE_DISTANCE = 2.2;
const FACE_EYE_DISTANCE_SMOOTH_UP = 0.35;
const FACE_EYE_DISTANCE_SMOOTH_DOWN = 0.08;
const FACE_ANCHOR_EYE_NOSE_BLEND_X = 0.42;
const FACE_ANCHOR_EYE_NOSE_BLEND_Y = 0.72;
const FACE_CUTOUT_CENTERING_WEIGHT_CAMERA = 0.92;
const FACE_CUTOUT_CENTERING_WEIGHT_SAMPLE = 1;

/**
 * Anchor plane and torso fallback constants.
 */
const ANCHOR_WORLD_Z = 0;
const SYNTHETIC_TORSO_LENGTH_FROM_SHOULDERS = 0.28;

/**
 * Tracking scale constraints per input mode.
 */
const CAMERA_SCALE_MULTIPLIER = 2.3;
const SAMPLE_SCALE_MULTIPLIER = 0.9;
const CAMERA_SCALE_MIN = 0.2;
const CAMERA_SCALE_MAX = 2.2;
const SAMPLE_SCALE_MIN = 0.15;
const SAMPLE_SCALE_MAX = 1.15;

/**
 * Sample images available for no-camera debug/test mode.
 */
const SAMPLE_IMAGES: Record<string, string> = {
  "sample-1": publicAssetUrl("samples/sample-1.png"),
  "sample-2": publicAssetUrl("samples/sample-2.png"),
  "sample-3": publicAssetUrl("samples/sample-3.png"),
};

/**
 * Global debug mode flag controlled by URL.
 */
const DEBUG_ENABLED =
  new URLSearchParams(window.location.search).get("debug") === "1" ||
  baseRelativePathname().startsWith(SAMPLE_ROUTE_PREFIX);

export {
  ANCHOR_WORLD_Z,
  BODY_MIN_VISIBILITY,
  BODY_POSITION_DEADBAND,
  BODY_POS_SMOOTH,
  BODY_ROTATION_DEADBAND_RAD,
  BODY_ROLL_FROM_SHOULDERS,
  BODY_ROT_SMOOTH,
  BODY_SCALE_SMOOTH,
  CAMERA_SCALE_MAX,
  CAMERA_SCALE_MIN,
  CAMERA_SCALE_MULTIPLIER,
  DEBUG_ENABLED,
  FACE_ANCHOR_EYE_NOSE_BLEND_X,
  FACE_ANCHOR_EYE_NOSE_BLEND_Y,
  FACE_ANCHOR_POSITION_BLEND_CAMERA,
  FACE_ANCHOR_POSITION_BLEND_SAMPLE,
  FACE_ANCHOR_SCALE_BLEND_CAMERA,
  FACE_ANCHOR_SCALE_BLEND_SAMPLE,
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
  FM_FOREHEAD,
  FACE_WINDOW_WIDTH_FROM_EYE_DISTANCE,
  FM_LEFT_EYE_OUTER,
  FM_LEFT_TEMPLE,
  FM_NOSE_TIP,
  FM_RIGHT_EYE_OUTER,
  FM_RIGHT_TEMPLE,
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
  POSE_LOST_HIDE_DELAY_MS,
  SAMPLE_IMAGES,
  SAMPLE_ROUTE_PREFIX,
  SAMPLE_SCALE_MAX,
  SAMPLE_SCALE_MIN,
  SAMPLE_SCALE_MULTIPLIER,
  SYNTHETIC_TORSO_LENGTH_FROM_SHOULDERS,
};
