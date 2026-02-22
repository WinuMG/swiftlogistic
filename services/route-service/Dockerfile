FROM node:18-alpine
WORKDIR /app
# Copy package.json and install dependencies
COPY ./services/route-service/package*.json ./
RUN npm install
# Copy service source code
COPY ./services/route-service/. .
# Copy shared code from project root
COPY ./shared ./shared
EXPOSE 3003
CMD ["node", "server.js"]
