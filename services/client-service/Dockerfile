FROM node:18-alpine
WORKDIR /app
# Copy package.json and package-lock.json for client-service
COPY ./services/client-service/package*.json ./
RUN npm install
# Copy all client-service files
COPY ./services/client-service/. .
# Copy shared directory from root

COPY ./shared ./shared
EXPOSE 3001
CMD ["node", "server.js"]
