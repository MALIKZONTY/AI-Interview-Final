"""
Video analysis: MediaPipe Face Mesh + iris gaze when available; OpenCV Haar fallback.
Metrics feed /evaluate-answer for confidence scoring.
"""

import tempfile
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, File, UploadFile

from app.mediapipe_gaze import iris_gaze_score_from_landmarks, try_create_face_mesh

router = APIRouter()


def _proximity_factor(ar: float) -> float:
    if ar <= 0.0:
        return 0.22
    if ar < 0.032:
        return float(np.clip(0.26 + 0.55 * (ar / 0.032), 0.15, 0.85))
    if ar < 0.055:
        return float(np.clip(0.72 + 0.28 * ((ar - 0.032) / 0.023), 0.72, 1.0))
    return 1.0


def _aggregate_motion_and_scores(
    *,
    face_ratio: float,
    motion_scores: list[float],
    centers_x: list[float],
    centers_y: list[float],
    offsets_from_center: list[float],
    face_area_ratios: list[float],
    gaze_scores: list[float],
    facing_scores: list[float],
    use_mediapipe_gaze: bool,
) -> dict:
    motion_mean = float(np.mean(motion_scores)) if motion_scores else 0.0

    if offsets_from_center:
        mean_off = float(np.mean(offsets_from_center))
        std_off = float(np.std(offsets_from_center)) if len(offsets_from_center) > 1 else 0.0
        max_off = float(np.max(offsets_from_center))
        mean_term = max(0.0, 100.0 * (1.0 - mean_off / 0.28))
        consistency_term = max(0.0, 100.0 * (1.0 - min(1.0, std_off / 0.14)))
        worst_term = max(0.0, 100.0 * (1.0 - max_off / 0.44))
        bbox_gaze = max(
            0.0,
            min(100.0, 0.38 * mean_term + 0.37 * consistency_term + 0.25 * worst_term),
        )
        var_x = float(np.var(centers_x)) if len(centers_x) > 1 else 0.0
        var_y = float(np.var(centers_y)) if len(centers_y) > 1 else 0.0
        face_position_variance = var_x + var_y
    else:
        std_off = 0.0
        bbox_gaze = 0.0
        face_position_variance = 0.25

    face_area_ratio_avg = float(np.mean(face_area_ratios)) if face_area_ratios else 0.0

    if use_mediapipe_gaze and gaze_scores:
        mp_mean = float(np.mean(gaze_scores))
        mp_std = float(np.std(gaze_scores)) if len(gaze_scores) > 1 else 0.0
        consistency_mp = max(0.0, 100.0 * (1.0 - min(1.0, mp_std / 18.0)))
        gaze_center_score = float(
            np.clip(0.78 * mp_mean + 0.12 * consistency_mp + 0.10 * bbox_gaze, 0, 100)
        )
        # Eyes scanning / head moving: high frame-to-frame gaze variance must not score "steady"
        if mp_std > 6.5:
            gaze_center_score *= float(np.clip(1.05 - 0.038 * (mp_std - 6.5), 0.38, 1.0))
        # Scale to ~same order as bbox offset std for /evaluate-answer penalties
        gaze_offset_std_out = mp_std / 100.0 if len(gaze_scores) > 1 else 0.0
    else:
        gaze_center_score = bbox_gaze
        gaze_offset_std_out = float(std_off) if offsets_from_center else 0.0

    prox = _proximity_factor(face_area_ratio_avg)
    gaze_center_score *= prox

    facing_camera_avg = float(np.mean(facing_scores)) if facing_scores else -1.0
    if use_mediapipe_gaze and facing_scores:
        fa = facing_camera_avg
        if fa < 65.0:
            gaze_center_score *= float(np.clip(0.48 + 0.52 * (fa / 65.0), 0.38, 1.0))
        elif fa < 78.0:
            gaze_center_score *= float(0.82 + 0.18 * ((fa - 65.0) / 13.0))

    motion_scores_arr = np.array(motion_scores, dtype=np.float64) if motion_scores else np.array([])
    motion_p90 = float(np.percentile(motion_scores_arr, 90)) if motion_scores_arr.size else 0.0
    motion_combined = 0.72 * motion_mean + 0.28 * motion_p90
    motion_stability = max(0.0, 100.0 - min(100.0, motion_combined * 4.1))
    drift_penalty = min(100.0, face_position_variance * 460.0)
    head_stability = max(0.0, 0.50 * motion_stability + 0.50 * (100.0 - drift_penalty))
    head_stability = float(
        head_stability * (0.55 + 0.45 * min(1.0, face_area_ratio_avg / 0.055))
    )

    presence = min(100.0, face_ratio * 110.0) * (
        0.42 + 0.58 * min(1.0, face_area_ratio_avg / 0.058)
    )
    eye_contact_proxy = max(0.0, 0.28 * presence + 0.72 * gaze_center_score)
    if face_ratio < 0.38:
        eye_contact_proxy *= 0.62 + 0.38 * (face_ratio / 0.38)
    if face_ratio < 0.22:
        eye_contact_proxy *= 0.75

    note = "MediaPipe Face Mesh + iris gaze + OpenCV motion"
    if not use_mediapipe_gaze:
        note = "OpenCV Haar fallback (MediaPipe unavailable or no face)"

    return {
        "face_detected_ratio": round(face_ratio, 4),
        "face_area_ratio_avg": round(face_area_ratio_avg, 5),
        "gaze_center_score": round(gaze_center_score, 2),
        "gaze_offset_std": round(gaze_offset_std_out, 5),
        "face_position_variance": round(face_position_variance, 5),
        "head_motion_mean": round(motion_mean, 4),
        "head_motion_p90": round(motion_p90, 4),
        "eye_contact_proxy": round(eye_contact_proxy, 2),
        "head_stability": round(head_stability, 2),
        "gaze_mediapipe_used": use_mediapipe_gaze and len(gaze_scores) > 0,
        "facing_camera_avg": round(facing_camera_avg, 2) if facing_camera_avg >= 0 else None,
        "note": note,
    }


def _run_mediapipe(path: Path) -> dict | None:
    face_mesh = try_create_face_mesh()
    if face_mesh is None:
        return None

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None

    frames_checked = 0
    faces = 0
    prev_gray = None
    motion_scores: list[float] = []
    centers_x: list[float] = []
    centers_y: list[float] = []
    offsets_from_center: list[float] = []
    face_area_ratios: list[float] = []
    gaze_scores: list[float] = []
    facing_scores: list[float] = []

    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    step = max(int(fps / 3), 1)
    idx = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % step != 0:
                idx += 1
                continue
            idx += 1
            h, w = frame.shape[:2]
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = face_mesh.process(rgb)

            if prev_gray is not None:
                diff = cv2.absdiff(gray, prev_gray)
                motion_scores.append(float(np.mean(diff)))
            prev_gray = gray
            frames_checked += 1

            if res.multi_face_landmarks:
                faces += 1
                lms = res.multi_face_landmarks[0]
                m = iris_gaze_score_from_landmarks(lms, w, h)
                nx, ny = 0.5, 0.5
                try:
                    pts = lms.landmark
                    nlm = min(478, len(pts))
                    xs = [pts[i].x for i in range(nlm)]
                    ys = [pts[i].y for i in range(nlm)]
                    nx = (min(xs) + max(xs)) / 2
                    ny = (min(ys) + max(ys)) / 2
                except (IndexError, AttributeError, ValueError):
                    pass
                centers_x.append(float(nx))
                centers_y.append(float(ny))
                if m is not None:
                    gaze_scores.append(m.gaze_at_camera)
                    facing_scores.append(m.facing_camera_score)
                    offsets_from_center.append(m.face_center_offset)
                    face_area_ratios.append(m.face_area_ratio)
                else:
                    off = float(np.hypot(nx - 0.5, ny - 0.5))
                    offsets_from_center.append(off)
                    face_area_ratios.append(0.06)

            if frames_checked >= 45:
                break
    finally:
        cap.release()
        face_mesh.close()

    if frames_checked == 0:
        return None

    face_ratio = faces / frames_checked
    out = _aggregate_motion_and_scores(
        face_ratio=face_ratio,
        motion_scores=motion_scores,
        centers_x=centers_x,
        centers_y=centers_y,
        offsets_from_center=offsets_from_center,
        face_area_ratios=face_area_ratios,
        gaze_scores=gaze_scores,
        facing_scores=facing_scores,
        use_mediapipe_gaze=True,
    )
    out["frames_sampled"] = frames_checked
    return out


def _run_haar(path: Path) -> dict | None:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None

    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    frames_checked = 0
    faces = 0
    prev_gray = None
    motion_scores: list[float] = []
    centers_x: list[float] = []
    centers_y: list[float] = []
    offsets_from_center: list[float] = []
    face_area_ratios: list[float] = []

    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    step = max(int(fps / 3), 1)
    idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step != 0:
            idx += 1
            continue
        idx += 1
        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        rects = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(40, 40))
        if len(rects) > 0:
            faces += 1
            x, y, rw, rh = max(rects, key=lambda r: r[2] * r[3])
            nx = (x + rw / 2) / max(w, 1)
            ny = (y + rh / 2) / max(h, 1)
            centers_x.append(float(nx))
            centers_y.append(float(ny))
            offsets_from_center.append(float(np.hypot(nx - 0.5, ny - 0.5)))
            face_area_ratios.append(float(rw * rh) / float(max(w * h, 1)))
        if prev_gray is not None:
            diff = cv2.absdiff(gray, prev_gray)
            motion_scores.append(float(np.mean(diff)))
        prev_gray = gray
        frames_checked += 1
        if frames_checked >= 45:
            break

    cap.release()

    if frames_checked == 0:
        return None

    face_ratio = faces / frames_checked
    out = _aggregate_motion_and_scores(
        face_ratio=face_ratio,
        motion_scores=motion_scores,
        centers_x=centers_x,
        centers_y=centers_y,
        offsets_from_center=offsets_from_center,
        face_area_ratios=face_area_ratios,
        gaze_scores=[],
        facing_scores=[],
        use_mediapipe_gaze=False,
    )
    out["frames_sampled"] = frames_checked
    return out


@router.post("/analyze-video")
async def analyze_video(file: UploadFile = File(...)):
    suffix = Path(file.filename or "v").suffix or ".webm"
    raw = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(raw)
        path = Path(tmp.name)

    try:
        result = _run_mediapipe(path)
        if result is None:
            result = _run_haar(path)
        if result is None:
            return _defaults("unreadable")

        # MediaPipe can miss faces in harsh lighting / profile — try Haar if almost no detections
        if result.get("face_detected_ratio", 0) < 0.06:
            fb = _run_haar(path)
            if fb is not None and fb.get("face_detected_ratio", 0) > result.get("face_detected_ratio", 0):
                fb["note"] = "OpenCV Haar fallback (stronger face detection on this clip)"
                return fb

        return result
    finally:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def _defaults(reason: str):
    return {
        "face_detected_ratio": 0.0,
        "face_area_ratio_avg": 0.0,
        "gaze_center_score": 35.0,
        "gaze_offset_std": 0.06,
        "face_position_variance": 0.1,
        "head_motion_mean": 10.0,
        "head_motion_p90": 14.0,
        "eye_contact_proxy": 35.0,
        "head_stability": 40.0,
        "gaze_mediapipe_used": False,
        "facing_camera_avg": None,
        "note": reason,
    }
