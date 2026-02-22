FROM node:18-alpine
WORKDIR /app
COPY services/service-registry/package*.json ./
RUN npm install --production
COPY services/service-registry/ .
EXPOSE 3009
CMD ["node", "server.js"]
