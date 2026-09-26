# Optional: package the keeper for Railway / Render / a VPS. Mount or copy the deployment record and
# pass the env vars from .env.example.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV DEPLOYMENTS_PATH=/app/deployments/active.json
EXPOSE 8081
CMD ["npx", "tsx", "src/index.ts"]
