FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN corepack enable

COPY package.json pnpm-lock.yaml /app/
RUN pnpm install --frozen-lockfile

COPY ./ /app/

# Leave these empty to use same-origin URLs (nginx proxies to the backend).
ARG VITE_WS_BACKEND_URL=
ARG VITE_HTTP_BACKEND_URL=
ENV VITE_WS_BACKEND_URL=$VITE_WS_BACKEND_URL \
    VITE_HTTP_BACKEND_URL=$VITE_HTTP_BACKEND_URL

RUN pnpm build

FROM nginx:1.27-alpine

# nginx's official image renders /etc/nginx/templates/*.template with envsubst.
ENV BACKEND_URL=http://backend:7001
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
