import * as THREE from "three";
import { BODY_MIN_VISIBILITY } from "./tracking-constants";
import type { PoseLandmark, ProjectionContext } from "./tracking-types";

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
 * Converts normalized source-image landmark coordinates into viewport NDC.
 *
 * Uses object-fit contain projection so sample landmarks match on-screen image
 * placement when letterboxing is present.
 *
 * @param landmark - Landmark in source-image normalized coordinates
 * @param projectionContext - Source and viewport dimension context
 * @returns Viewport NDC x/y in the range [-1, 1]
 */
function ndcFromLandmarkContained(
  landmark: { x: number; y: number },
  projectionContext: ProjectionContext,
): { x: number; y: number } {
  const { sourceWidth, sourceHeight, viewportWidth, viewportHeight } =
    projectionContext;
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return ndcFromLandmark(landmark);
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const viewportAspect = viewportWidth / viewportHeight;
  let displayWidth = viewportWidth;
  let displayHeight = viewportHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (sourceAspect > viewportAspect) {
    displayWidth = viewportWidth;
    displayHeight = viewportWidth / sourceAspect;
    offsetY = (viewportHeight - displayHeight) * 0.5;
  } else {
    displayHeight = viewportHeight;
    displayWidth = viewportHeight * sourceAspect;
    offsetX = (viewportWidth - displayWidth) * 0.5;
  }

  const screenX = offsetX + landmark.x * displayWidth;
  const screenY = offsetY + landmark.y * displayHeight;
  return {
    x: (screenX / viewportWidth - 0.5) * 2,
    y: -(screenY / viewportHeight - 0.5) * 2,
  };
}

/**
 * Converts a normalized source-image landmark into viewport-normalized [0,1] space.
 *
 * This uses the same object-fit contain projection as anchoring logic so debug
 * overlays line up with sample images that are letterboxed.
 *
 * @param landmark - Landmark in source-image normalized coordinates
 * @param projectionContext - Source and viewport dimension context
 * @returns Viewport-normalized x/y coordinates in the range [0, 1]
 */
function viewportNormalizedFromLandmarkContained(
  landmark: { x: number; y: number },
  projectionContext: ProjectionContext,
): { x: number; y: number } {
  const ndc = ndcFromLandmarkContained(landmark, projectionContext);
  return {
    x: ndc.x * 0.5 + 0.5,
    y: 0.5 - ndc.y * 0.5,
  };
}

/**
 * Computes 2D landmark distance in the same coordinate space used for anchoring.
 *
 * In sample mode this uses contained-viewport NDC so letterboxing and viewport
 * size changes do not bias body/face scale estimates.
 *
 * @param a - First normalized landmark
 * @param b - Second normalized landmark
 * @param projectionContext - Optional source/viewport projection context
 * @returns Euclidean distance in anchor coordinate space
 */
function landmarkDistanceForScale(
  a: { x: number; y: number },
  b: { x: number; y: number },
  projectionContext?: ProjectionContext,
): number {
  if (!projectionContext) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  const aNdc = ndcFromLandmarkContained(a, projectionContext);
  const bNdc = ndcFromLandmarkContained(b, projectionContext);
  return Math.hypot(aNdc.x - bNdc.x, aNdc.y - bNdc.y);
}

/**
 * Returns a normalized confidence score for a pose landmark.
 *
 * @param landmark - Pose landmark with optional visibility/presence metadata
 * @returns Confidence score in the range [0, 1], defaulting to 1 when absent
 */
function landmarkConfidence(
  landmark: { visibility?: number; presence?: number },
): number {
  return Math.min(landmark.visibility ?? 1, landmark.presence ?? 1);
}

/**
 * Checks if a pose landmark exists and passes the configured confidence floor.
 *
 * @param landmark - Pose landmark candidate to validate
 * @returns True when the landmark exists and is confident enough for tracking
 */
function isReliableLandmark(landmark?: PoseLandmark): landmark is PoseLandmark {
  return !!landmark && landmarkConfidence(landmark) >= BODY_MIN_VISIBILITY;
}

/**
 * Converts an NDC coordinate into world space at a fixed Z plane.
 *
 * @param camera - Active perspective camera
 * @param ndcX - NDC x coordinate in the range [-1, 1]
 * @param ndcY - NDC y coordinate in the range [-1, 1]
 * @param targetWorldZ - Z plane in world space where the point should land
 * @returns World-space point projected from the NDC coordinate
 */
function worldPointFromNdc(
  camera: THREE.PerspectiveCamera,
  ndcX: number,
  ndcY: number,
  targetWorldZ: number,
): THREE.Vector3 {
  const projected = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
  const direction = projected.sub(camera.position).normalize();
  const distance = (targetWorldZ - camera.position.z) / direction.z;
  return camera.position.clone().add(direction.multiplyScalar(distance));
}

export {
  isReliableLandmark,
  landmarkConfidence,
  landmarkDistanceForScale,
  ndcFromLandmark,
  ndcFromLandmarkContained,
  viewportNormalizedFromLandmarkContained,
  worldPointFromNdc,
};
