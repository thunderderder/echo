FROM python:3.11-slim

WORKDIR /app

# Install Node.js and npm for building frontend
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy package files and install frontend dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy application code
COPY . .

# Build frontend
RUN npm run build

# Expose port (PORT will be set at runtime by Koyeb)
EXPOSE 8001

# Start application using PORT environment variable
# Use shell form (sh -c) to ensure environment variable expansion
CMD sh -c "python server.py"
