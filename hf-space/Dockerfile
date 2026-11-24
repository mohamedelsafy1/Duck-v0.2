FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
# يسحب آخر نسخة من الريبو عند كل Build (Factory reboot يعيد السحب)
ARG CACHEBUST=1
RUN git clone --depth 1 https://github.com/mohamedelsafy1/Duck-v0.2.git /app && chown -R node:node /app
WORKDIR /app
USER node
RUN npm ci && npm run build
ENV NODE_ENV=production PORT=7860
EXPOSE 7860
CMD ["npm", "start"]
