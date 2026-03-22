FROM node:20-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
  && pip3 install --no-cache-dir yt-dlp \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV PORT=10000
ENV DOWNLOADS_DIR=downloads

RUN npm run build

EXPOSE 10000

CMD ["npm", "start", "--", "-p", "10000", "-H", "0.0.0.0"]
