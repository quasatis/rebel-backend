FROM node:20-alpine AS build

RUN apk update && apk add --no-cache \
  build-base gcc autoconf automake zlib-dev libpng-dev vips-dev git python3

WORKDIR /opt/app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev=false

COPY . .

# Dummy secrets so `strapi build` can compile admin without real production keys
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=1337 \
  APP_KEYS=buildKey1,buildKey2,buildKey3,buildKey4 \
  API_TOKEN_SALT=buildApiTokenSalt \
  ADMIN_JWT_SECRET=buildAdminJwt \
  TRANSFER_TOKEN_SALT=buildTransferSalt \
  JWT_SECRET=buildJwtSecret \
  DATABASE_CLIENT=mysql \
  DATABASE_HOST=localhost \
  DATABASE_PORT=3306 \
  DATABASE_NAME=rebelafrique \
  DATABASE_USERNAME=strapi \
  DATABASE_PASSWORD=strapi

RUN npm run build

FROM node:20-alpine

RUN apk update && apk add --no-cache vips-dev wget \
  && addgroup -g 1001 strapi \
  && adduser -u 1001 -G strapi -s /bin/sh -D strapi

WORKDIR /opt/app

COPY --from=build --chown=strapi:strapi /opt/app ./

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=1337
ENV NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"

USER strapi
EXPOSE 1337

CMD ["npm", "run", "start"]
