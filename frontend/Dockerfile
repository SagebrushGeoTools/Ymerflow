FROM node:22 AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY 30-headlamp-token.sh /docker-entrypoint.d/30-headlamp-token.sh
RUN chmod +x /docker-entrypoint.d/30-headlamp-token.sh
EXPOSE 80
