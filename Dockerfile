# Use Node.js 20 base image
FROM node:20-slim

# Install system dependencies (Python for AI, FFmpeg for Video processing, etc.)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    libpq-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Enable Corepack and set up pnpm
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

# Create a non-root user for Hugging Face (standard UID 1000)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# Set container working directory
WORKDIR /home/user/app

# Copy the monorepo structure and ensure ownership
COPY --chown=user . .

# Install all Node.js dependencies across the monorepo
RUN pnpm install

# Build the applications (includes Prisma generation and TypeScript compilation)
RUN pnpm build

# Install Python requirements for the AI Engine
# Using --break-system-packages is safe within a dedicated Docker container
RUN cd services/ai-service && pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Environment configuration
ENV NODE_ENV=production \
    PORT=7860

# Expose the correct Hugging Face port
EXPOSE 7860

# Ensure the orchestration script has execution permissions
RUN chmod +x entrypoint.sh

# Launch the integrated services
CMD ["./entrypoint.sh"]
