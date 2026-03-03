import * as THREE from "three";
import type {
  FaceLandmarkerResult,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  BODY_MIN_VISIBILITY,
  BODY_ROLL_FROM_SHOULDERS,
  CAMERA_SCALE_MAX,
  CAMERA_SCALE_MIN,
  CAMERA_SCALE_MULTIPLIER,
  FACE_ANCHOR_EYE_NOSE_BLEND_X,
  FACE_ANCHOR_EYE_NOSE_BLEND_Y,
  FACE_SCALE_MAX,
  FACE_SCALE_MIN,
  FACE_SCALE_MULTIPLIER,
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
  SAMPLE_SCALE_MAX,
  SAMPLE_SCALE_MIN,
  SAMPLE_SCALE_MULTIPLIER,
  SYNTHETIC_TORSO_LENGTH_FROM_SHOULDERS,
} from "./tracking-constants";
import {
  isReliableLandmark,
  landmarkConfidence,
  landmarkDistanceForScale,
  ndcFromLandmark,
  ndcFromLandmarkContained,
  viewportNormalizedFromLandmarkContained,
} from "./landmark-helpers";
import type {
  FaceAnchor,
  HeadRotation,
  PoseLandmark,
  TorsoAnchor,
  TorsoAnchorOptions,
} from "./tracking-types";

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
  const shouldersReliable = [leftShoulder, rightShoulder].map(landmarkConfidence);
  const hipsReliable = isReliableLandmark(leftHip) && isReliableLandmark(rightHip);
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
function headRotationFromFace(result: FaceLandmarkerResult): HeadRotation | null {
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
  headRotation: HeadRotation | null,
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
  // Gentle yaw-to-roll coupling keeps silhouette tilt natural on side turns.
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

export {
  blendAnchorRotation,
  faceAnchorFromFace,
  headRotationFromFace,
  torsoAnchorFromPose,
};
