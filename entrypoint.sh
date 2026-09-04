#!/bin/bash

# Start the Python AI Service in the background
echo "Starting Python AI Service..."
cd /app/services/ai-service
# Use the system python to run uvicorn
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &

# Start the Fastify API on Hugging Face's required port 7860
echo "Starting Fastify API..."
cd /app/apps/api
# We explicitly set the port to 7860 for Hugging Face
export PORT=7860
npm start
