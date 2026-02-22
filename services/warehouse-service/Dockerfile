FROM node:18-alpine
WORKDIR /app
# Copy package.json and install dependencies
COPY ./services/warehouse-service/package*.json ./
RUN npm install
# Copy service source code
COPY ./services/warehouse-service/. .
# Copy shared code from project root
COPY ./shared ./shared
EXPOSE 3004
CMD ["node", "server.js"]
