# Paneltec Group — web app. Builds the React app, then serves it with nginx,
# which also forwards /api to the backend container (so one address does everything).
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000
COPY . .
# Empty backend URL = call /api on the same address the page came from.
ENV REACT_APP_BACKEND_URL="" \
    GENERATE_SOURCEMAP=false \
    NODE_OPTIONS=--max-old-space-size=3072
RUN yarn build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
