#!/bin/bash
# Dev server startup — loads .env explicitly then starts Next.js
cd /home/z/my-project

# Source .env to get all variables into the process environment
set -a
source .env
set +a

# Start Next.js dev server (detached, survives parent shell exit)
exec bun run dev
