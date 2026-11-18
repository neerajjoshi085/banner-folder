FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
COPY vendor/website-image-packager ./vendor/website-image-packager
RUN npm ci
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["npm", "start"]
