"""
MediaPipe Face Mesh (refine_landmarks) — iris-based gaze-at-camera proxy.
Indices follow the 478-landmark mesh with iris refinement enabled.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    pass


# Left / right iris centers (refine_landmarks=True)
_L_IRIS = 468
_R_IRIS = 473
# Eye corners (horizontal span)
_L_EYE_OUT, _L_EYE_IN = 33, 133
_R_EYE_IN, _R_EYE_OUT = 362, 263
# Vertical extent (eyelids) — left / right eyes
_L_TOP, _L_BOT = 159, 145
_R_TOP, _R_BOT = 386, 374
# Head facing camera (symmetry / nose alignment) — iris alone misses “looking at notes”
_NOSE = 1
_CHIN = 152
_L_CHEEK = 234
_R_CHEEK = 454
_FOREHEAD = 10
_L_BROW_IN = 107
_R_BROW_IN = 336


@dataclass
class FrameGazeMetrics:
    """Per-frame metrics in 0–100 scales where noted."""

    gaze_at_camera: float  # combined iris + head facing (for scoring)
    iris_in_eye_score: float  # raw iris-in-opening score
    facing_camera_score: float  # head oriented toward lens
    face_center_offset: float  # bbox center distance from frame center, normalized ~0–0.7
    face_area_ratio: float  # face mesh bbox / frame


def facing_camera_score_from_pts(pts) -> float:
    """
    0–100: frontal head toward webcam (not reading down / profile).
    Uses nose vs cheek symmetry + nose vs brow ridge + nose height along face (pitch proxy).
    """
    try:
        if len(pts) < 455:
            return 50.0
    except (TypeError, AttributeError):
        return 50.0

    def px(i: int):
        return pts[i].x, pts[i].y

    nose_x, nose_y = px(_NOSE)
    lc_x, _ = px(_L_CHEEK)
    rc_x, _ = px(_R_CHEEK)
    mid_face_x = (lc_x + rc_x) / 2.0
    cheek_span = max(abs(rc_x - lc_x), 1e-5)
    nose_yaw = abs(nose_x - mid_face_x) / cheek_span
    yaw_sym = float(max(0.0, min(100.0, 100.0 * (1.0 - min(1.0, nose_yaw / 0.13)))))

    lb_x, _ = px(_L_BROW_IN)
    rb_x, _ = px(_R_BROW_IN)
    brow_mid = (lb_x + rb_x) / 2.0
    brow_span = max(abs(rb_x - lb_x), 1e-5)
    nose_brow = abs(nose_x - brow_mid) / brow_span
    yaw_brow = float(max(0.0, min(100.0, 100.0 * (1.0 - min(1.0, nose_brow / 0.16)))))

    yaw_combined = 0.52 * yaw_sym + 0.48 * yaw_brow

    _, fy = px(_FOREHEAD)
    _, chin_y = px(_CHIN)
    eye_y = (px(_L_TOP)[1] + px(_L_BOT)[1] + px(_R_TOP)[1] + px(_R_BOT)[1]) / 4.0
    face_span = max(chin_y - fy, 1e-5)
    t_nose = (nose_y - fy) / face_span
    # Seated frontal webcam: nose usually ~0.42–0.62 between forehead and chin in normalized y
    pitch_pen = abs(float(t_nose) - 0.52)
    pitch_score = float(max(0.0, min(100.0, 100.0 * (1.0 - min(1.0, pitch_pen / 0.18)))))

    out = 0.46 * yaw_combined + 0.54 * pitch_score
    return float(max(0.0, min(100.0, out)))


def iris_gaze_score_from_landmarks(lm, frame_w: int, frame_h: int) -> FrameGazeMetrics | None:
    """
    Map iris position relative to eye opening to a 0–100 "looking at camera" score.
    """
    try:
        pts = lm.landmark
        if len(pts) < 478:
            return None
    except (TypeError, AttributeError, IndexError):
        return None

    def p(i: int):
        return (pts[i].x, pts[i].y)

    # Left eye: center + spans
    lx = (p(_L_EYE_OUT)[0] + p(_L_EYE_IN)[0]) / 2
    ly = (p(_L_TOP)[1] + p(_L_BOT)[1]) / 2
    ew_l = max(abs(p(_L_EYE_OUT)[0] - p(_L_EYE_IN)[0]), 1e-5)
    eh_l = max(abs(p(_L_TOP)[1] - p(_L_BOT)[1]), 1e-5)

    ox_l = abs(p(_L_IRIS)[0] - lx) / ew_l
    oy_l = abs(p(_L_IRIS)[1] - ly) / eh_l

    rx = (p(_R_EYE_IN)[0] + p(_R_EYE_OUT)[0]) / 2
    ry = (p(_R_TOP)[1] + p(_R_BOT)[1]) / 2
    ew_r = max(abs(p(_R_EYE_IN)[0] - p(_R_EYE_OUT)[0]), 1e-5)
    eh_r = max(abs(p(_R_TOP)[1] - p(_R_BOT)[1]), 1e-5)

    ox_r = abs(p(_R_IRIS)[0] - rx) / ew_r
    oy_r = abs(p(_R_IRIS)[1] - ry) / eh_r

    horiz = (ox_l + ox_r) / 2.0
    vert = (oy_l + oy_r) / 2.0
    # Combined offset: 0 = iris centered, ~0.4+ = looking away
    combined = 0.55 * horiz + 0.45 * vert
    # Steeper curve: small iris offset maps to a much lower score
    iris_score = float(max(0.0, min(100.0, 100.0 * (1.0 - min(1.0, combined * 2.75)))))

    facing = facing_camera_score_from_pts(pts)
    # Must satisfy both iris-at-lens and head frontal; min() stops "steady but not looking" inflation
    geom = float(np.sqrt(max(iris_score, 1.0) * max(facing, 6.0)))
    gaze = float(max(0.0, min(100.0, 0.42 * min(iris_score, facing) + 0.58 * geom)))

    # Face bbox from all mesh points (468 face + iris)
    xs = [pts[i].x for i in range(min(478, len(pts)))]
    ys = [pts[i].y for i in range(min(478, len(pts)))]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    cx = (min_x + max_x) / 2.0
    cy = (min_y + max_y) / 2.0
    off = float(np.hypot(cx - 0.5, cy - 0.5))
    area = (max_x - min_x) * (max_y - min_y)

    return FrameGazeMetrics(
        gaze_at_camera=gaze,
        iris_in_eye_score=iris_score,
        facing_camera_score=facing,
        face_center_offset=off,
        face_area_ratio=float(area),
    )


def try_create_face_mesh():
    """Returns FaceMesh context manager or None if MediaPipe missing / init fails."""
    try:
        import mediapipe as mp  # noqa: PLC0415

        return mp.solutions.face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.45,
            min_tracking_confidence=0.45,
        )
    except Exception:
        return None
