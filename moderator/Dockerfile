FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 TEXT_MODEL_DIR=/models/toxic-bert
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
# Bake both models into the image (cached layer — downloads once)
RUN python -c "from nudenet import NudeDetector; NudeDetector()" && \
    python -c "from huggingface_hub import snapshot_download as s; s('Xenova/toxic-bert', local_dir='/models/toxic-bert', allow_patterns=['onnx/model_quantized.onnx','tokenizer.json','config.json'])"
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
