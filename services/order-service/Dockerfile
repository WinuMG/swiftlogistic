FROM node:18-alpine
WORKDIR /app
# Copy package.json and install dependencies
COPY ./services/order-service/package*.json ./
RUN npm install
# Copy service source code
COPY ./services/order-service/. .
# Copy shared code from project root
COPY ./shared ./shared
EXPOSE 3002
CMD ["node", "server.js"]
