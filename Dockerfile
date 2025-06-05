# Use an official Node.js runtime as a parent image
FROM node:18-bullseye-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies required for wrtc and other native modules
# build-essential includes gcc, g++, make
# python3 is needed for node-gyp
# pkg-config helps find installed libraries
# libopus-dev, libexpat1-dev, libnspr4-dev, libnss3-dev, libasound2-dev are common for WebRTC
# libavdevice-dev might be needed for some audio/video device access (though less common for server-side wrtc)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    make \
    pkg-config \
    libopus-dev \
    libexpat1-dev \
    libnspr4-dev \
    libnss3-dev \
    libasound2-dev \
    # libavdevice-dev \
    # Add any other specific system dependencies your project might need
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (or npm-shrinkwrap.json) to leverage Docker cache
COPY package*.json ./

# Install app dependencies
# If you have a clean slate and no node_modules, use npm ci for faster, more reliable builds
# RUN npm ci --only=production
RUN npm install

# Bundle app source
COPY . .

# Your app binds to port 3000, but Fly.io expects 8080 by default.
# We'll expose 3000 and rely on fly.toml to map external 8080 to internal 3000 if needed,
# or you can change your app to listen on process.env.PORT (which Fly sets to 8080).
# For now, let's assume your app listens on 3000 as per your logs.
EXPOSE 3000

# Define the command to run your app
CMD [ "npm", "run", "start" ]
