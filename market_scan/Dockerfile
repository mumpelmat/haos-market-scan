FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY rootfs/app/ ./
COPY public/ ./public/
COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 8080
CMD ["/run.sh"]
