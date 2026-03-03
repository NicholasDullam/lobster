import { DEBUG_ENABLED } from "./tracking-constants";
import { viewportNormalizedFromLandmarkContained } from "./landmark-helpers";
import type {
  DebugOverlay,
  FaceAnchor,
  PoseLandmark,
  ProjectionContext,
  TorsoAnchor,
  TrackingSource,
} from "./tracking-types";

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
 * @param faceAnchor - Computed face anchor data for the current frame
 * @param anchorVisible - Whether the rendered 3D anchor is currently visible
 * @param sourceMode - Current tracking source mode
 * @param projectionContext - Optional projection context used by sample mode
 */
function renderDebugOverlay(
  debugOverlay: DebugOverlay,
  width: number,
  height: number,
  torsoAnchor: TorsoAnchor | null,
  faceAnchor: FaceAnchor | null,
  anchorVisible: boolean,
  sourceMode: TrackingSource["mode"],
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
  const projectPoseDebugPoint = (landmark: PoseLandmark): PoseLandmark => {
    if (sourceMode !== "sample" || !projectionContext) {
      return landmark;
    }
    const point = viewportNormalizedFromLandmarkContained(
      landmark,
      projectionContext,
    );
    return { ...landmark, x: point.x, y: point.y };
  };
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

  status.textContent =
    `debug=1 | source=${sourceMode} | pose=ok | hipsReliable=${hipsReliable} | ` +
    `ndc=(${torsoAnchor.ndcX.toFixed(2)}, ${torsoAnchor.ndcY.toFixed(2)}) | ` +
    `scale=${torsoAnchor.scale.toFixed(2)} | ` +
    `faceScale=${faceAnchor?.scale.toFixed(2) ?? "n/a"} | ` +
    `anchorVisible=${anchorVisible}`;
}

export { renderDebugOverlay, setupDebugOverlay };
