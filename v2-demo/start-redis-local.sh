#!/bin/bash
# Quick Redis start script
if command -v redis-server &> /dev/null; then
    redis-server --daemonize yes --port 6379
    echo "Redis started on port 6379"
elif command -v docker &> /dev/null && docker ps &> /dev/null; then
    docker run -d --name redis-local -p 6379:6379 redis:6.2-alpine
    echo "Redis started via Docker on port 6379"
else
    echo "ERROR: Redis not available. Please install Redis:"
    echo "  brew install redis && brew services start redis"
    echo "  OR"
    echo "  Start Docker and run: docker run -d -p 6379:6379 redis:6.2-alpine"
    exit 1
fi
