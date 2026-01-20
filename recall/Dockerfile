FROM node:19

WORKDIR /app

# Copy package files from recall
COPY recall/package.json recall/package-lock.json ./

# Install dependencies
# npm install --production installs optional dependencies by default
# Explicitly install pg to ensure it's available for PostgreSQL
RUN npm ci --production && npm install pg pg-hstore --save-optional || npm install --production

# Copy application files from recall
COPY recall/ .

# Expose port
EXPOSE 3003

# Start the application
CMD ["npm", "start"]