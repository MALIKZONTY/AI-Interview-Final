from __future__ import annotations
"""
Video analysis, deliberately narrow: is the candidate on camera, and are they
looking at it.

Scoring elsewhere is voice-based (see app/voice.py). This adds one visual
dimension — eye contact — and nothing else. The earlier version of this file also
tracked head motion, positional drift and restlessness; those were noisy, hard to
defend to a candidate, and are not measured any more.

Returns:
  face_detected_ratio  share of sampled frames containing a face
  eye_contact_score    0-100, iris-at-camera blended with head orientation
  presence_score       0-100, face reliably in frame and close enough to read
"""

import logging
import tempfile
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from fastapi import APIRouter, File, UploadFile

from app.mediapipe_gaze import iris_gaze_score_from_landmarks, try_create_face_landmarker

logger = logging.getLogger(__name__)
router = APIRouter()

# Sampling: ~3 frames a second, capped, so a 30s clip stays well under a second of CPU.
TARGET_FPS = 3
MAX_FRAMES = 60


def _sample_frames(path: Path):
    """Yields (frame, width, height) at roughly TARGET_FPS, up to MAX_FRAMES."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        step = max(int(round(fps / TARGET_FPS)), 1)
        idx = 0
        taken = 0
        while taken < MAX_FRAMES:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % step == 0:
                h, w = frame.shape[:2]
                yield frame, w, h
                taken += 1
            idx += 1
    finally:
        cap.release()


def _analyse(path: Path) -> dict | None:
    landmarker = try_create_face_landmarker()
    if landmarker is None:
        logger.warning("MediaPipe unavailable; cannot score eye contact.")
        return "no_landmarker"  # type: ignore[return-value]

    frames = 0
    faces = 0
    gaze_scores: list[float] = []
    face_areas: list[float] = []

    try:
        for frame, w, h in _sample_frames(path):
            # VIDEO mode requires strictly increasing timestamps.
            stamp_ms = int(frames * (1000 / TARGET_FPS))
            frames += 1

            image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
            )
            result = landmarker.detect_for_video(image, stamp_ms)
            if not result.face_landmarks:
                continue

            faces += 1
            metrics = iris_gaze_score_from_landmarks(result.face_landmarks[0], w, h)
            if metrics is not None:
                gaze_scores.append(metrics.gaze_at_camera)
                face_areas.append(metrics.face_area_ratio)
    finally:
        landmarker.close()

    if frames == 0:
        return None

    face_ratio = faces / frames

    # Presence: on camera consistently, and close enough that gaze is actually readable.
    area_avg = float(np.mean(face_areas)) if face_areas else 0.0
    closeness = float(np.clip(area_avg / 0.055, 0.0, 1.0))
    presence = float(np.clip(100.0 * face_ratio * (0.45 + 0.55 * closeness), 0.0, 100.0))

    if gaze_scores:
        gaze_mean = float(np.mean(gaze_scores))
        # Looking away intermittently should not read the same as steady contact.
        steadiness = float(np.clip(100.0 - np.std(gaze_scores) * 1.6, 0.0, 100.0))
        eye_contact = 0.78 * gaze_mean + 0.22 * steadiness
        # A face missing from much of the clip caps how high eye contact can score.
        eye_contact *= 0.35 + 0.65 * face_ratio
        eye_contact = float(np.clip(eye_contact, 0.0, 100.0))
    else:
        eye_contact = 0.0

    return {
        "face_detected_ratio": round(face_ratio, 4),
        "eye_contact_score": round(eye_contact, 2),
        "presence_score": round(presence, 2),
        "face_area_ratio_avg": round(area_avg, 5),
        "frames_sampled": frames,
        "note": "MediaPipe Face Mesh with iris refinement",
    }


def _unavailable(reason: str) -> dict:
    """No visual signal. Nulls rather than a made-up score, so results can say so."""
    return {
        "face_detected_ratio": 0.0,
        "eye_contact_score": None,
        "presence_score": None,
        "face_area_ratio_avg": 0.0,
        "frames_sampled": 0,
        "note": reason,
    }


@router.post("/analyze-video")
async def analyze_video(file: UploadFile = File(...)):
    suffix = Path(file.filename or "clip").suffix or ".webm"
    raw = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(raw)
        path = Path(tmp.name)

    try:
        result = _analyse(path)
        if result == "no_landmarker":
            return _unavailable("face_analysis_unavailable")
        return result if result is not None else _unavailable("no_readable_video")
    except Exception as e:
        logger.warning("analyze-video failed: %s", e)
        return _unavailable("analysis_failed")
    finally:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
