FROM node:19

WORKDIR /app

# Copy package files from v2-demo
COPY v2-demo/package.json v2-demo/package-lock.json ./

# Install dependencies
RUN npm install --production

# Copy application files from v2-demo
COPY v2-demo/ .

# Expose port
EXPOSE 3003

# Start the application
CMD ["npm", "start"]