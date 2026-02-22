FROM node:18-alpine
WORKDIR /app
COPY services/wms-service/package*.json ./
RUN npm install --production
COPY services/wms-service/ .
COPY shared/ ./shared/
EXPOSE 4000 4001
CMD ["node", "server.js"]
