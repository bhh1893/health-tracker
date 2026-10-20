FROM python:3.12-slim
LABEL org.opencontainers.image.source="https://github.com/bhh1893/health-tracker"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
# Numeric non-root user so Kubernetes can enforce runAsNonRoot later.
RUN useradd --system --uid 10001 appuser
USER 10001
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
