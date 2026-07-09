FROM node:18-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production --silent

COPY . .

ENV PORT=5000
EXPOSE 5000

CMD ["node", "backend/server.js"]
