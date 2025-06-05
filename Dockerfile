# syntax = docker/dockerfile:1

# Use Node.js 18 bullseye-slim as the base image
ARG NODE_VERSION=18
FROM node:${NODE_VERSION}-bullseye-slim AS base

LABEL fly_launch_runtime="Node.js"

# Set the working directory in the container
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"

# Throw-away build stage to reduce size of final image
FROM base AS build

# Install system dependencies required for wrtc and other native modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
    build-essential \
    python3 \
    make \
    pkg-config \
    libopus-dev \
    libexpat1-dev \
    libnspr4-dev \
    libnss3-dev \
    libasound2-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install node modules
RUN npm install

# Copy application code
COPY . .

# Final stage for app image
FROM base

# Copy built application from the build stage
COPY --from=build /app /app

# Expose port 3000 (your app listens on this port)
EXPOSE 3000

# Start the server by default
CMD [ "npm", "run", "start" ]
