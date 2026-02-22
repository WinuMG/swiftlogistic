FROM node:18-alpine
WORKDIR /app
# Copy package.json and install dependencies
COPY ./services/api-gateway/package*.json ./
RUN npm install
# Copy service source code
COPY ./services/api-gateway/. .
# Copy shared code from project root
COPY ./shared ./shared
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));" || exit 1
CMD ["node", "server.js"]
