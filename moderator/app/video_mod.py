"""Image/frame moderation with NudeNet (MIT, ONNX, CPU ~30 ms/frame)."""
from __future__ import annotations

import os
import threading

import cv2
import numpy as np
from nudenet import NudeDetector

# Classes that count as a violation (explicit nudity).
NUDE = {
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
    "BUTTOCKS_EXPOSED",
    "ANUS_EXPOSED",
}
# Classes that count as "suggestive" — logged, not auto-muted.
SUGGESTIVE = {
    "FEMALE_BREAST_COVERED",
    "BUTTOCKS_COVERED",
    "FEMALE_GENITALIA_COVERED",
    "BELLY_EXPOSED",
    "MALE_BREAST_EXPOSED",
}
MIN_SCORE = float(os.getenv("NSFW_MIN_SCORE", "0.45"))

_detector: NudeDetector | None = None
_lock = threading.Lock()


def detector() -> NudeDetector:
    global _detector
    if _detector is None:
        with _lock:
            if _detector is None:
                _detector = NudeDetector()
    return _detector


def classify(image: np.ndarray | bytes) -> dict:
    """image: RGBA numpy array (h, w, 4) or encoded bytes (jpg/png/webp).
    NudeNet internally converts RGBA→BGR, so everything is normalised to RGBA."""
    if isinstance(image, (bytes, bytearray)):
        bgr = cv2.imdecode(np.frombuffer(image, np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            return {"verdict": "error", "score": 0.0, "detections": [], "error": "unreadable image"}
        image = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA)
    with _lock:  # onnxruntime session is shared; keep calls serialized
        dets = detector().detect(image)
    dets = [d for d in dets if d["score"] >= MIN_SCORE]
    nude = [d for d in dets if d["class"] in NUDE]
    sexy = [d for d in dets if d["class"] in SUGGESTIVE]
    verdict = "nude" if nude else "suggestive" if sexy else "safe"
    top = max((d["score"] for d in nude or sexy), default=0.0)
    return {
        "verdict": verdict,
        "score": round(float(top), 3),
        "detections": [
            {"class": d["class"], "score": round(float(d["score"]), 3), "box": [int(v) for v in d["box"]]}
            for d in dets
        ],
    }
