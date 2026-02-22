FROM node:18-alpine
WORKDIR /app
COPY services/integration-service/package*.json ./
RUN npm install --production
COPY services/integration-service/ .
COPY shared/ ./shared/
EXPOSE 3008
CMD ["node", "server.js"]
