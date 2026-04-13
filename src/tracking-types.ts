import type * as THREE from "three";
import type { FilterCutoutWindow } from "./filter-material-profile";

/**
 * Runtime frame source configuration for pose/face tracking.
 */
type TrackingSource =
  | {
      /**
       * Live webcam source mode.
       */
      mode: "camera";
      /**
       * Hidden playing video element used by MediaPipe detectForVideo.
       */
      frameSource: HTMLVideoElement;
      /**
       * Tears down camera tracks and related resources.
       */
      release: () => void;
    }
  | {
      /**
       * Static sample image source mode.
       */
      mode: "sample";
      /**
       * Decoded image element used by MediaPipe detect.
       */
      frameSource: HTMLImageElement;
      /**
       * Removes any sample-mode DOM artifacts.
       */
      release: () => void;
    };

/**
 * Pose landmark used by local tracking helpers.
 */
type PoseLandmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
};

/**
 * Context describing how source coordinates project into the viewport.
 */
type ProjectionContext = {
  sourceWidth: number;
  sourceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

/**
 * Torso anchor transform and debug points derived from pose landmarks.
 */
type TorsoAnchor = {
  ndcX: number;
  ndcY: number;
  scale: number;
  shoulderWidth: number;
  rotation: THREE.Quaternion;
  debug: {
    shoulderCenter: PoseLandmark;
    hipCenter: PoseLandmark;
    chestCenter: PoseLandmark;
    leftShoulder: PoseLandmark;
    rightShoulder: PoseLandmark;
    leftHip?: PoseLandmark;
    rightHip?: PoseLandmark;
    hipsReliable: boolean;
  };
};

/**
 * Face anchor and debug points derived from face landmarks.
 */
type FaceAnchor = {
  ndcX: number;
  ndcY: number;
  scale: number;
  eyeDistance: number;
  eyeDeltaNdcX: number;
  eyeDeltaNdcY: number;
  debug: {
    leftEye: { x: number; y: number; z: number };
    rightEye: { x: number; y: number; z: number };
    noseTip: { x: number; y: number; z: number };
    anchorPoint: { x: number; y: number; z: number };
  };
};

/**
 * Headwear anchor and debug points derived from forehead and temple landmarks.
 */
type HeadwearAnchor = {
  ndcX: number;
  ndcY: number;
  templeDeltaNdcX: number;
  templeDeltaNdcY: number;
  templeWidth: number;
  debug: {
    leftTemple: { x: number; y: number; z: number };
    rightTemple: { x: number; y: number; z: number };
    forehead: { x: number; y: number; z: number };
    crownPoint: { x: number; y: number; z: number };
  };
};

/**
 * Debug overlay canvas and status UI nodes.
 */
type DebugOverlay = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  status: HTMLDivElement;
};

/**
 * Options controlling torso/face anchor solving behavior by mode.
 */
type TorsoAnchorOptions = {
  projectionContext?: ProjectionContext;
  isSampleMode: boolean;
};

/**
 * Debug helper set for one material cutout target.
 */
type CutoutDebugEntry = {
  mesh: THREE.Mesh;
  cutout: FilterCutoutWindow;
  boundsHelper: THREE.Mesh;
  centerHelper: THREE.Mesh;
};

/**
 * Anchor-local offset that aligns the face cutout center.
 */
type PrimaryCutoutAnchor = {
  offset: THREE.Vector3;
  windowWidth: number;
};

/**
 * Head Euler rotation values extracted from face landmarks.
 */
type HeadRotation = {
  yaw: number;
  pitch: number;
  roll: number;
};

export type {
  CutoutDebugEntry,
  DebugOverlay,
  FaceAnchor,
  HeadwearAnchor,
  HeadRotation,
  PoseLandmark,
  PrimaryCutoutAnchor,
  ProjectionContext,
  TorsoAnchor,
  TorsoAnchorOptions,
  TrackingSource,
};
