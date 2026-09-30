FROM node:20-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/storage/data UPLOAD_DIR=/app/storage/uploads
VOLUME ["/app/storage"]
EXPOSE 3000
CMD ["node", "server.js"]
