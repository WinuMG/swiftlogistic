FROM node:18-alpine
WORKDIR /app
COPY services/cms-service/package*.json ./
RUN npm install --production
COPY services/cms-service/ .
COPY shared/ ./shared/
EXPOSE 3007
CMD ["node", "server.js"]
