from __future__ import annotations
"""
Vocal delivery metrics and the confidence score built from them.

Replaces the old camera-based confidence (gaze / head stability). Everything here
comes from the answer audio plus Whisper's segment timestamps, so no video is
recorded, uploaded or stored at any point.

Signals used:
  pace        words per minute while actually speaking
  fluency     filler-word density and pause behaviour
  steadiness  how much vocal energy varies (monotone vs erratic)
  projection  overall loudness relative to the noise floor
  flow        share of the answer window actually spent speaking
"""

import re
import wave
from pathlib import Path
from typing import Any

import numpy as np

# Score used when only part of the signal set is available, so a partial
# measurement cannot swing the result to either extreme on its own.
NEUTRAL_CONFIDENCE = 60.0

# Gap between Whisper segments that counts as a deliberate pause.
PAUSE_GAP_SECONDS = 0.35
LONG_PAUSE_SECONDS = 1.2

_FILLER_RE = re.compile(
    r"\b(um|uh|uhm|erm|er|ah|hmm|hm|like|you know|basically|actually|sort of|kind of|i mean)\b",
    re.IGNORECASE,
)


def _band(x: float, lo_bad: float, lo_good: float, hi_good: float, hi_bad: float) -> float:
    """100 inside [lo_good, hi_good], ramping linearly to 0 at lo_bad / hi_bad."""
    if x <= lo_bad or x >= hi_bad:
        return 0.0
    if lo_good <= x <= hi_good:
        return 100.0
    if x < lo_good:
        return 100.0 * (x - lo_bad) / max(lo_good - lo_bad, 1e-6)
    return 100.0 * (hi_bad - x) / max(hi_bad - hi_good, 1e-6)


def _read_wav_mono(path: Path) -> tuple[np.ndarray, int] | None:
    """Loads a PCM wav as float32 in [-1, 1]. Returns None if unreadable."""
    try:
        with wave.open(str(path), "rb") as wf:
            n_channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            rate = wf.getframerate()
            frames = wf.readframes(wf.getnframes())
    except Exception:
        return None

    if not frames:
        return None

    dtype_map = {1: np.uint8, 2: np.int16, 4: np.int32}
    dtype = dtype_map.get(sample_width)
    if dtype is None:
        return None

    data = np.frombuffer(frames, dtype=dtype).astype(np.float32)
    if sample_width == 1:
        data = (data - 128.0) / 128.0
    else:
        data = data / float(np.iinfo(dtype).max)

    if n_channels > 1:
        usable = (len(data) // n_channels) * n_channels
        data = data[:usable].reshape(-1, n_channels).mean(axis=1)

    return data, rate


def _energy_stats(path: Path | None) -> dict[str, float | None]:
    """RMS energy over 50ms frames, restricted to frames above the noise floor."""
    empty: dict[str, float | None] = {
        "energy_mean": None,
        "energy_cv": None,
        "audio_seconds": None,
    }
    if path is None or not path.exists():
        return empty

    loaded = _read_wav_mono(path)
    if loaded is None:
        return empty
    samples, rate = loaded
    if samples.size == 0 or rate <= 0:
        return empty

    frame = max(int(rate * 0.05), 1)
    usable = (samples.size // frame) * frame
    if usable < frame:
        return empty

    rms = np.sqrt(np.mean(samples[:usable].reshape(-1, frame) ** 2, axis=1))
    if rms.size == 0:
        return empty

    # Noise floor: quietest quarter of frames. Voiced frames sit well above it.
    floor = float(np.percentile(rms, 25))
    voiced = rms[rms > max(floor * 2.0, 1e-4)]
    if voiced.size < 3:
        voiced = rms

    mean = float(np.mean(voiced))
    std = float(np.std(voiced))
    return {
        "energy_mean": round(mean, 6),
        "energy_cv": round(std / mean, 4) if mean > 1e-6 else None,
        "audio_seconds": round(samples.size / float(rate), 2),
    }


def extract_metrics(
    *,
    text: str,
    segments: list[dict[str, Any]],
    wav_path: Path | None = None,
    window_seconds: float | None = None,
) -> dict[str, Any]:
    """Builds the raw voice_meta payload sent to /evaluate-answer."""
    words = re.findall(r"[A-Za-z']+", text or "")
    word_count = len(words)

    spans = [
        (float(s.get("start", 0.0)), float(s.get("end", 0.0)))
        for s in segments
        if s.get("end") is not None and float(s.get("end", 0)) > float(s.get("start", 0))
    ]
    spans.sort()

    speaking_seconds = sum(e - s for s, e in spans)
    lead_in = spans[0][0] if spans else 0.0
    speech_end = spans[-1][1] if spans else 0.0

    gaps = [
        spans[i + 1][0] - spans[i][1]
        for i in range(len(spans) - 1)
        if spans[i + 1][0] - spans[i][1] >= PAUSE_GAP_SECONDS
    ]

    energy = _energy_stats(wav_path)
    total_seconds = (
        window_seconds
        or energy.get("audio_seconds")
        or (speech_end if speech_end > 0 else None)
    )

    wpm = (word_count / (speaking_seconds / 60.0)) if speaking_seconds > 0.5 else None
    fillers = len(_FILLER_RE.findall(text or ""))
    filler_rate = (fillers / word_count * 100.0) if word_count else 0.0

    return {
        "word_count": word_count,
        "speaking_seconds": round(speaking_seconds, 2),
        "total_seconds": round(float(total_seconds), 2) if total_seconds else None,
        "speaking_ratio": (
            round(speaking_seconds / float(total_seconds), 4)
            if total_seconds and float(total_seconds) > 0
            else None
        ),
        "wpm": round(wpm, 1) if wpm else None,
        "filler_count": fillers,
        "filler_rate": round(filler_rate, 2),
        "pause_count": len(gaps),
        "long_pause_count": sum(1 for g in gaps if g >= LONG_PAUSE_SECONDS),
        "mean_pause": round(float(np.mean(gaps)), 2) if gaps else 0.0,
        "max_pause": round(float(max(gaps)), 2) if gaps else 0.0,
        "pause_ratio": (
            round(sum(gaps) / float(total_seconds), 4)
            if total_seconds and float(total_seconds) > 0
            else 0.0
        ),
        "lead_in_seconds": round(lead_in, 2),
        "segment_count": len(spans),
        **energy,
    }


def confidence_from_voice(vm: dict[str, Any] | None) -> tuple[float, dict[str, Any], str]:
    """
    Returns (confidence 0-100, per-component breakdown, short natural-language notes
    handed to the LLM so its feedback can talk about delivery).
    """
    vm = vm or {}

    def num(key: str) -> float | None:
        v = vm.get(key)
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    word_count = num("word_count") or 0.0
    if word_count < 3:
        return 0.0, {"reason": "no_speech_detected"}, "The answer had almost no audible speech."

    components: dict[str, float] = {}
    weights: dict[str, float] = {}

    # Pace — natural interview delivery sits near 110-160 wpm.
    wpm = num("wpm")
    if wpm is not None:
        components["pace"] = _band(wpm, 45.0, 110.0, 165.0, 250.0)
        weights["pace"] = 0.22

    # Fluency — filler density plus how much of the answer was dead air.
    filler_rate = num("filler_rate") or 0.0
    pause_ratio = num("pause_ratio") or 0.0
    long_pauses = num("long_pause_count") or 0.0
    filler_part = max(0.0, 100.0 - filler_rate * 7.0)
    pause_part = max(0.0, 100.0 - pause_ratio * 180.0 - long_pauses * 7.0)
    components["fluency"] = 0.55 * filler_part + 0.45 * pause_part
    weights["fluency"] = 0.30

    # Steadiness — some variation reads as engaged; none reads monotone, lots reads erratic.
    energy_cv = num("energy_cv")
    if energy_cv is not None:
        components["steadiness"] = _band(energy_cv, 0.05, 0.30, 0.85, 1.60)
        weights["steadiness"] = 0.16

    # Projection — speaking up. Values are RMS on a [-1, 1] waveform.
    energy_mean = num("energy_mean")
    if energy_mean is not None:
        components["projection"] = _band(energy_mean, 0.004, 0.030, 0.320, 0.750)
        weights["projection"] = 0.14

    # Flow — share of the answer window actually spent talking.
    speaking_ratio = num("speaking_ratio")
    if speaking_ratio is not None:
        components["flow"] = float(np.clip(speaking_ratio * 145.0, 0.0, 100.0))
        weights["flow"] = 0.18

    total_weight = sum(weights.values())
    if total_weight <= 0:
        return NEUTRAL_CONFIDENCE, {"reason": "insufficient_voice_metrics"}, ""

    score = sum(components[k] * weights[k] for k in weights) / total_weight

    # With only part of the signal set available (e.g. the wav could not be decoded)
    # pull toward neutral rather than trusting one component to carry the whole score.
    if total_weight < 1.0:
        score = score * total_weight + NEUTRAL_CONFIDENCE * (1.0 - total_weight)

    # Hesitating a long time before starting reads as uncertainty.
    lead_in = num("lead_in_seconds") or 0.0
    if lead_in > 2.5:
        score -= min(8.0, (lead_in - 2.5) * 2.5)

    # A handful of words is not a confident answer regardless of how it sounded.
    if word_count < 25:
        score *= 0.55 + 0.45 * (word_count / 25.0)

    score = float(np.clip(score, 0.0, 100.0))

    notes = [f"Delivery score: {round(score, 1)}/100."]
    if wpm is not None:
        if wpm < 95:
            notes.append("Spoke quite slowly.")
        elif wpm > 175:
            notes.append("Spoke quickly, bordering on rushed.")
        else:
            notes.append("Kept a steady speaking pace.")
    if filler_rate > 8:
        notes.append("Leaned on filler words fairly often.")
    if long_pauses >= 2:
        notes.append("Had a few long hesitations mid-answer.")
    if energy_cv is not None and energy_cv < 0.30:
        notes.append("Tone stayed fairly flat.")
    if energy_mean is not None and energy_mean < 0.030:
        notes.append("Voice was quiet throughout.")
    if speaking_ratio is not None and speaking_ratio < 0.45:
        notes.append("Left a lot of the answer window unused.")

    breakdown = {k: round(v, 2) for k, v in components.items()}
    breakdown["weights"] = {k: round(v / total_weight, 3) for k, v in weights.items()}
    breakdown["lead_in_penalty_applied"] = lead_in > 2.5

    return round(score, 2), breakdown, " ".join(notes)
