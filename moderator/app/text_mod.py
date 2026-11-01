"""Text moderation: fast word filter (English + Hindi/Hinglish) + ONNX toxic-bert.

Model: Xenova/toxic-bert (Apache-2.0, ONNX port of unitary/toxic-bert).
Runs on CPU with onnxruntime — no torch needed. If the model can't be loaded,
the service keeps working with the word filter only.
"""
from __future__ import annotations

import logging
import os
import re
import unicodedata
from pathlib import Path

import numpy as np

log = logging.getLogger("text_mod")

LABELS = ["toxic", "severe_toxic", "obscene", "threat", "insult", "identity_hate"]
THRESHOLD = float(os.getenv("TEXT_TOXIC_THRESHOLD", "0.70"))

LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"})


def _load_wordlist() -> list[re.Pattern]:
    path = Path(__file__).with_name("blocked_words.txt")
    pats = []
    for line in path.read_text(encoding="utf-8").splitlines():
        w = line.strip().lower()
        if not w or w.startswith("#"):
            continue
        sep = r"[\W_]*"
        if " " in w or not w.isascii():
            body = re.escape(w).replace(r"\ ", r"\s+")
        else:
            # each letter may repeat, with separators between repeats: f.u.u.c.k
            body = sep.join(f"{re.escape(c)}(?:{sep}{re.escape(c)})*" for c in w)
            # common suffixes: fucking, fucker, fucked, chutiya…
            body += rf"(?:{sep}(?:i{sep}n{sep}g|i{sep}n|e{sep}r{sep}s?|e{sep}d|e{sep}s|s|y{sep}a))?"
        pats.append(re.compile(rf"(?<![a-zऀ-ॿ]){body}(?![a-zऀ-ॿ])", re.IGNORECASE))
    return pats


WORD_PATTERNS = _load_wordlist()
LINK_RE = re.compile(r"(https?://|www\.)\S+|\b\S+\.(com|net|xyz|ru|in|io|link|click)\b", re.IGNORECASE)
PHONE_RE = re.compile(r"(?:\+?91[\s-]?)?[6-9]\d{9}\b")


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", text).lower()
    return t.translate(LEET)


class ToxicModel:
    def __init__(self) -> None:
        self.session = None
        self.tokenizer = None
        self.input_names: list[str] = []
        model_dir = Path(os.getenv("TEXT_MODEL_DIR", "/models/toxic-bert"))
        onnx_path = model_dir / "onnx" / "model_quantized.onnx"
        tok_path = model_dir / "tokenizer.json"
        try:
            if not onnx_path.exists():
                from huggingface_hub import snapshot_download

                snapshot_download(
                    "Xenova/toxic-bert",
                    local_dir=str(model_dir),
                    allow_patterns=["onnx/model_quantized.onnx", "tokenizer.json", "config.json"],
                )
            import onnxruntime as ort
            from tokenizers import Tokenizer

            so = ort.SessionOptions()
            so.intra_op_num_threads = int(os.getenv("TEXT_MODEL_THREADS", "2"))
            self.session = ort.InferenceSession(str(onnx_path), so, providers=["CPUExecutionProvider"])
            self.input_names = [i.name for i in self.session.get_inputs()]
            self.tokenizer = Tokenizer.from_file(str(tok_path))
            self.tokenizer.enable_truncation(max_length=128)
            log.info("toxic-bert loaded (%s)", onnx_path)
        except Exception as e:  # noqa: BLE001
            log.warning("toxic-bert unavailable, using word filter only: %s", e)

    @property
    def ready(self) -> bool:
        return self.session is not None

    def scores(self, text: str) -> dict[str, float]:
        if not self.ready:
            return {}
        enc = self.tokenizer.encode(text)
        feeds = {}
        ids = np.array([enc.ids], dtype=np.int64)
        for name in self.input_names:
            if name == "input_ids":
                feeds[name] = ids
            elif name == "attention_mask":
                feeds[name] = np.array([enc.attention_mask], dtype=np.int64)
            elif name == "token_type_ids":
                feeds[name] = np.zeros_like(ids)
        logits = self.session.run(None, feeds)[0][0]
        probs = 1 / (1 + np.exp(-logits))
        return {LABELS[i]: round(float(p), 4) for i, p in enumerate(probs[: len(LABELS)])}


MODEL: ToxicModel | None = None


def get_model() -> ToxicModel:
    global MODEL
    if MODEL is None:
        MODEL = ToxicModel()
    return MODEL


def moderate_text(text: str, block_links: bool = True) -> dict:
    raw = text.strip()
    if not raw:
        return {"allowed": False, "reason": "empty", "flags": [], "scores": {}, "masked": ""}
    if len(raw) > 500:
        return {"allowed": False, "reason": "too_long", "flags": ["too_long"], "scores": {}, "masked": raw[:500]}

    norm = normalize(raw)
    flags: list[str] = []
    chars = list(raw) if len(norm) == len(raw) else None
    masked = raw
    for p in WORD_PATTERNS:
        for m in p.finditer(norm):
            flags.append("profanity")
            if chars is not None:  # mask using positions found in the normalised text
                for i in range(m.start(), m.end()):
                    if not chars[i].isspace():
                        chars[i] = "*"
    if chars is not None:
        masked = "".join(chars)
    if block_links and LINK_RE.search(raw):
        flags.append("link")
    if PHONE_RE.search(re.sub(r"\s", "", raw)):
        flags.append("phone_number")

    scores = get_model().scores(raw)
    for label, s in scores.items():
        if s >= THRESHOLD:
            flags.append(label)

    flags = sorted(set(flags))
    allowed = not flags
    return {
        "allowed": allowed,
        "reason": None if allowed else flags[0],
        "flags": flags,
        "scores": scores,
        "masked": masked,
        "model": "toxic-bert" if get_model().ready else "wordlist-only",
    }
