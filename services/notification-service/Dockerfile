FROM node:18-alpine
WORKDIR /app
# Copy package.json and install dependencies
COPY ./services/notification-service/package*.json ./
RUN npm install
# Copy service source code
COPY ./services/notification-service/. .
# Copy shared code from project root
COPY ./shared ./shared
EXPOSE 3005
CMD ["node", "server.js"]
